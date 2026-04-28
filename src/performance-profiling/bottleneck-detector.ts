import { Injectable } from '@nestjs/common';
import { BottleneckDto, BottleneckCategory, BottleneckSeverity } from '../dto/bottleneck.dto';
import { CpuSample } from '../collectors/cpu-profiler';
import { MemorySample } from '../collectors/memory-profiler';
import { QuerySample } from '../collectors/query-profiler';
import { ApiSample } from '../collectors/api-profiler';

export interface BottleneckDetectorConfig {
  cpuHighThresholdPercent: number;
  cpuCriticalThresholdPercent: number;
  memoryHighPercent: number;
  memoryCriticalPercent: number;
  heapGrowthHighMbPerMin: number;
  slowQueryThresholdMs: number;
  slowQueryCountThreshold: number;
  slowApiThresholdMs: number;
  errorRateThresholdPercent: number;
}

const DEFAULTS: BottleneckDetectorConfig = {
  cpuHighThresholdPercent: 70,
  cpuCriticalThresholdPercent: 90,
  memoryHighPercent: 80,
  memoryCriticalPercent: 95,
  heapGrowthHighMbPerMin: 5,
  slowQueryThresholdMs: 100,
  slowQueryCountThreshold: 10,
  slowApiThresholdMs: 500,
  errorRateThresholdPercent: 5,
};

@Injectable()
export class BottleneckDetector {
  private config: BottleneckDetectorConfig = DEFAULTS;

  configure(overrides: Partial<BottleneckDetectorConfig>): void {
    this.config = { ...DEFAULTS, ...overrides };
  }

  analyzeAll(data: {
    cpuSamples: CpuSample[];
    memorySamples: MemorySample[];
    querySamples: QuerySample[];
    apiSamples: ApiSample[];
  }): BottleneckDto[] {
    return [
      ...this.analyzeCpu(data.cpuSamples),
      ...this.analyzeMemory(data.memorySamples),
      ...this.analyzeQueries(data.querySamples),
      ...this.analyzeApi(data.apiSamples),
    ].sort((a, b) => this.severityScore(b.severity) - this.severityScore(a.severity));
  }

  private analyzeCpu(samples: CpuSample[]): BottleneckDto[] {
    if (!samples.length) return [];
    const bottlenecks: BottleneckDto[] = [];

    const usages = samples.map((s) => s.snapshot.usagePercent);
    const avg = usages.reduce((a, b) => a + b, 0) / usages.length;
    const peak = Math.max(...usages);
    const sustainedHighCount = usages.filter(
      (u) => u >= this.config.cpuHighThresholdPercent,
    ).length;
    const sustainedRatio = sustainedHighCount / usages.length;

    if (peak >= this.config.cpuCriticalThresholdPercent) {
      bottlenecks.push({
        category: BottleneckCategory.CPU,
        severity:
          avg >= this.config.cpuCriticalThresholdPercent
            ? BottleneckSeverity.CRITICAL
            : BottleneckSeverity.HIGH,
        title: 'CPU spike detected',
        description: `CPU peaked at ${peak.toFixed(1)}% with an average of ${avg.toFixed(1)}%`,
        detectedAt: samples[usages.indexOf(peak)].timestamp,
        metric: 'cpu_usage_percent',
        observedValue: peak,
        threshold: this.config.cpuCriticalThresholdPercent,
        unit: '%',
        recommendation:
          'Profile hot functions with flame-graph. Consider offloading CPU-heavy tasks to worker threads or a queue.',
        occurrences: 1,
        sampleData: { avg, peak, sustainedRatio },
      });
    } else if (sustainedRatio > 0.5 && avg >= this.config.cpuHighThresholdPercent) {
      bottlenecks.push({
        category: BottleneckCategory.CPU,
        severity: BottleneckSeverity.MEDIUM,
        title: 'Sustained high CPU usage',
        description: `CPU stayed above ${this.config.cpuHighThresholdPercent}% for ${(sustainedRatio * 100).toFixed(0)}% of the session`,
        detectedAt: samples[0].timestamp,
        metric: 'cpu_usage_percent',
        observedValue: avg,
        threshold: this.config.cpuHighThresholdPercent,
        unit: '%',
        recommendation:
          'Review synchronous heavy computation in the event loop. Enable clustering or horizontal scaling.',
        occurrences: sustainedHighCount,
        sampleData: { avg, peak, sustainedRatio },
      });
    }

    return bottlenecks;
  }

  private analyzeMemory(samples: MemorySample[]): BottleneckDto[] {
    if (!samples.length) return [];
    const bottlenecks: BottleneckDto[] = [];

    const heapPcts = samples.map((s) => s.snapshot.heapUsagePercent);
    const peakPct = Math.max(...heapPcts);
    const peakIdx = heapPcts.indexOf(peakPct);

    if (peakPct >= this.config.memoryCriticalPercent) {
      bottlenecks.push({
        category: BottleneckCategory.MEMORY,
        severity: BottleneckSeverity.CRITICAL,
        title: 'Heap near exhaustion',
        description: `Heap usage reached ${peakPct.toFixed(1)}% of total heap`,
        detectedAt: samples[peakIdx].timestamp,
        metric: 'heap_usage_percent',
        observedValue: peakPct,
        threshold: this.config.memoryCriticalPercent,
        unit: '%',
        recommendation:
          'Capture a heap snapshot and inspect retained objects. Increase --max-old-space-size or fix leaking closures/event-listeners.',
        sampleData: {
          peakHeapMb: samples[peakIdx].snapshot.heapUsedMb,
          peakTotalMb: samples[peakIdx].snapshot.heapTotalMb,
        },
      });
    } else if (peakPct >= this.config.memoryHighPercent) {
      bottlenecks.push({
        category: BottleneckCategory.MEMORY,
        severity: BottleneckSeverity.HIGH,
        title: 'High heap utilisation',
        description: `Heap usage peaked at ${peakPct.toFixed(1)}%`,
        detectedAt: samples[peakIdx].timestamp,
        metric: 'heap_usage_percent',
        observedValue: peakPct,
        threshold: this.config.memoryHighPercent,
        unit: '%',
        recommendation:
          'Review caching strategies. Ensure streams are properly destroyed after use.',
        sampleData: { peakPct },
      });
    }

    // Detect linear heap growth → potential leak
    if (samples.length >= 5) {
      const first = samples[0].snapshot.heapUsedMb;
      const last = samples[samples.length - 1].snapshot.heapUsedMb;
      const durationMin =
        (samples[samples.length - 1].timestamp.getTime() -
          samples[0].timestamp.getTime()) /
        60000;
      const growthRate = durationMin > 0 ? (last - first) / durationMin : 0;

      if (growthRate >= this.config.heapGrowthHighMbPerMin) {
        bottlenecks.push({
          category: BottleneckCategory.MEMORY,
          severity:
            growthRate >= this.config.heapGrowthHighMbPerMin * 5
              ? BottleneckSeverity.CRITICAL
              : BottleneckSeverity.HIGH,
          title: 'Possible memory leak detected',
          description: `Heap is growing at ~${growthRate.toFixed(2)} MB/min`,
          detectedAt: samples[0].timestamp,
          metric: 'heap_growth_mb_per_min',
          observedValue: Math.round(growthRate * 100) / 100,
          threshold: this.config.heapGrowthHighMbPerMin,
          unit: 'MB/min',
          recommendation:
            'Use heap snapshot to identify retained objects. Check for unclosed DB connections, listeners, or growing caches.',
          sampleData: { first, last, durationMin },
        });
      }
    }

    return bottlenecks;
  }

  private analyzeQueries(samples: QuerySample[]): BottleneckDto[] {
    if (!samples.length) return [];
    const bottlenecks: BottleneckDto[] = [];

    const slowQueries = samples.filter((s) => s.snapshot.isSlow);
    const slowRate = (slowQueries.length / samples.length) * 100;

    if (slowQueries.length >= this.config.slowQueryCountThreshold) {
      const durations = slowQueries.map((s) => s.snapshot.durationMs).sort((a, b) => a - b);
      const p99 = durations[Math.floor(durations.length * 0.99)] ?? durations[durations.length - 1];

      bottlenecks.push({
        category: BottleneckCategory.QUERY,
        severity: slowRate > 30 ? BottleneckSeverity.CRITICAL : BottleneckSeverity.HIGH,
        title: 'Excessive slow database queries',
        description: `${slowQueries.length} slow queries detected (${slowRate.toFixed(1)}% of all queries)`,
        detectedAt: slowQueries[0].timestamp,
        metric: 'slow_query_count',
        observedValue: slowQueries.length,
        threshold: this.config.slowQueryCountThreshold,
        unit: 'queries',
        recommendation:
          'Run EXPLAIN ANALYSE on flagged queries. Add missing indexes or enable query result caching.',
        occurrences: slowQueries.length,
        sampleData: {
          slowRate,
          p99DurationMs: p99,
          tables: [...new Set(slowQueries.map((s) => s.snapshot.table).filter(Boolean))],
        },
      });
    }

    // N+1 pattern — many queries hitting same table rapidly
    const tableFrequency: Record<string, number> = {};
    for (const s of samples) {
      if (s.snapshot.table) {
        tableFrequency[s.snapshot.table] = (tableFrequency[s.snapshot.table] ?? 0) + 1;
      }
    }

    for (const [table, count] of Object.entries(tableFrequency)) {
      if (count > 50 && samples.length > 0) {
        const rate = (count / samples.length) * 100;
        if (rate > 60) {
          bottlenecks.push({
            category: BottleneckCategory.QUERY,
            severity: BottleneckSeverity.MEDIUM,
            title: `Possible N+1 query pattern on "${table}"`,
            description: `${count} queries targeted "${table}" (${rate.toFixed(1)}% of all queries)`,
            detectedAt: new Date(),
            metric: 'query_concentration_percent',
            observedValue: rate,
            threshold: 60,
            unit: '%',
            affectedResource: table,
            recommendation:
              'Use TypeORM eager/explicit joins or a DataLoader-style batch approach to reduce per-row queries.',
            occurrences: count,
          });
        }
      }
    }

    return bottlenecks;
  }

  private analyzeApi(samples: ApiSample[]): BottleneckDto[] {
    if (!samples.length) return [];
    const bottlenecks: BottleneckDto[] = [];

    const durations = samples.map((s) => s.snapshot.durationMs);
    const p99 = [...durations].sort((a, b) => a - b)[Math.floor(durations.length * 0.99)] ?? 0;
    const errors = samples.filter((s) => s.snapshot.statusCode >= 500);
    const errorRate = (errors.length / samples.length) * 100;

    if (p99 >= this.config.slowApiThresholdMs * 5) {
      bottlenecks.push({
        category: BottleneckCategory.API,
        severity: BottleneckSeverity.HIGH,
        title: 'API tail latency extremely high',
        description: `P99 response time is ${p99.toFixed(0)} ms`,
        detectedAt: new Date(),
        metric: 'api_p99_ms',
        observedValue: p99,
        threshold: this.config.slowApiThresholdMs * 5,
        unit: 'ms',
        recommendation:
          'Identify slow endpoints in the per-route breakdown. Add response caching, database indexes, or circuit breakers.',
        sampleData: { p99, totalRequests: samples.length },
      });
    }

    if (errorRate >= this.config.errorRateThresholdPercent) {
      bottlenecks.push({
        category: BottleneckCategory.API,
        severity:
          errorRate >= 20 ? BottleneckSeverity.CRITICAL : BottleneckSeverity.HIGH,
        title: 'High 5xx error rate',
        description: `${errorRate.toFixed(1)}% of API requests resulted in server errors`,
        detectedAt: new Date(),
        metric: 'api_error_rate_percent',
        observedValue: Math.round(errorRate * 100) / 100,
        threshold: this.config.errorRateThresholdPercent,
        unit: '%',
        recommendation:
          'Check application logs for unhandled exceptions. Add retry logic for transient dependencies.',
        occurrences: errors.length,
      });
    }

    return bottlenecks;
  }

  private severityScore(s: BottleneckSeverity): number {
    return { critical: 4, high: 3, medium: 2, low: 1 }[s] ?? 0;
  }
}
