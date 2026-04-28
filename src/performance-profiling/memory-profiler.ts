import { Injectable, Logger } from '@nestjs/common';
import { MemorySnapshot } from '../entities/performance-snapshot.entity';

export interface MemorySample {
  timestamp: Date;
  snapshot: MemorySnapshot;
}

const MB = 1024 * 1024;

@Injectable()
export class MemoryProfiler {
  private readonly logger = new Logger(MemoryProfiler.name);
  private gcStats = { count: 0, totalDurationMs: 0 };

  constructor() {
    // Hook into V8 GC events if perf_hooks is available
    this.tryHookGc();
  }

  private tryHookGc(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { PerformanceObserver, constants } = require('perf_hooks');
      const obs = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.gcStats.count++;
          this.gcStats.totalDurationMs += entry.duration;
        }
      });
      obs.observe({ entryTypes: ['gc'], buffered: false });
    } catch {
      this.logger.debug('GC performance observer not available');
    }
  }

  async capture(): Promise<MemorySample> {
    const timestamp = new Date();
    const mem = process.memoryUsage();

    const heapUsedMb = mem.heapUsed / MB;
    const heapTotalMb = mem.heapTotal / MB;

    const snapshot: MemorySnapshot = {
      heapUsedMb: Math.round(heapUsedMb * 100) / 100,
      heapTotalMb: Math.round(heapTotalMb * 100) / 100,
      externalMb: Math.round((mem.external / MB) * 100) / 100,
      rssMs: Math.round((mem.rss / MB) * 100) / 100,
      arrayBuffersMb: Math.round(((mem.arrayBuffers ?? 0) / MB) * 100) / 100,
      heapUsagePercent: Math.round((heapUsedMb / heapTotalMb) * 10000) / 100,
      gcCount: this.gcStats.count,
      gcDurationMs: Math.round(this.gcStats.totalDurationMs),
    };

    return { timestamp, snapshot };
  }

  async collectSamples(
    durationMs: number,
    intervalMs: number,
    onSample: (sample: MemorySample) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const end = Date.now() + durationMs;

    while (Date.now() < end && !signal.aborted) {
      try {
        const sample = await this.capture();
        onSample(sample);
      } catch (err) {
        this.logger.warn(`Memory sample capture failed: ${err.message}`);
      }
      await this.sleep(intervalMs);
    }
  }

  detectLeaks(samples: MemorySample[]): {
    leakSuspected: boolean;
    growthRateMbPerMin: number;
    indicators: Array<{ metric: string; growthPerMinuteMb: number; severity: string }>;
  } {
    if (samples.length < 5) {
      return { leakSuspected: false, growthRateMbPerMin: 0, indicators: [] };
    }

    const first = samples[0].snapshot;
    const last = samples[samples.length - 1].snapshot;
    const durationMin =
      (samples[samples.length - 1].timestamp.getTime() - samples[0].timestamp.getTime()) /
      60000;

    if (durationMin === 0) return { leakSuspected: false, growthRateMbPerMin: 0, indicators: [] };

    const heapGrowth = (last.heapUsedMb - first.heapUsedMb) / durationMin;
    const rssGrowth = (last.rssMs - first.rssMs) / durationMin;
    const externalGrowth = (last.externalMb - first.externalMb) / durationMin;

    const indicators: Array<{ metric: string; growthPerMinuteMb: number; severity: string }> = [];

    const classify = (rate: number): string => {
      if (rate > 50) return 'critical';
      if (rate > 20) return 'high';
      if (rate > 5) return 'medium';
      return 'low';
    };

    if (heapGrowth > 2) {
      indicators.push({
        metric: 'heapUsed',
        growthPerMinuteMb: Math.round(heapGrowth * 100) / 100,
        severity: classify(heapGrowth),
      });
    }
    if (rssGrowth > 5) {
      indicators.push({
        metric: 'rss',
        growthPerMinuteMb: Math.round(rssGrowth * 100) / 100,
        severity: classify(rssGrowth),
      });
    }
    if (externalGrowth > 2) {
      indicators.push({
        metric: 'external',
        growthPerMinuteMb: Math.round(externalGrowth * 100) / 100,
        severity: classify(externalGrowth),
      });
    }

    return {
      leakSuspected: heapGrowth > 5,
      growthRateMbPerMin: Math.round(heapGrowth * 100) / 100,
      indicators,
    };
  }

  computeStats(samples: MemorySample[]): {
    avg: number;
    peak: number;
    peakAt: Date;
    growthMb: number;
  } {
    if (!samples.length) return { avg: 0, peak: 0, peakAt: new Date(), growthMb: 0 };

    const heaps = samples.map((s) => s.snapshot.heapUsedMb);
    const peak = Math.max(...heaps);
    const peakSample = samples[heaps.indexOf(peak)];

    return {
      avg: Math.round((heaps.reduce((a, b) => a + b, 0) / heaps.length) * 100) / 100,
      peak,
      peakAt: peakSample?.timestamp ?? new Date(),
      growthMb: Math.round((heaps[heaps.length - 1] - heaps[0]) * 100) / 100,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
