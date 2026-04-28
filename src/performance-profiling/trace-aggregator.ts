import { Injectable } from '@nestjs/common';
import { CpuSample } from '../collectors/cpu-profiler';
import { MemorySample } from '../collectors/memory-profiler';
import { QuerySample } from '../collectors/query-profiler';
import { ApiSample } from '../collectors/api-profiler';

export interface TracePoint {
  timestamp: Date;
  cpuPercent?: number;
  heapMb?: number;
  activeQueries?: number;
  apiRequestsPerSec?: number;
}

export interface CorrelatedAnomaly {
  timestamp: Date;
  windowMs: number;
  cpuSpike?: boolean;
  memorySpike?: boolean;
  querySpike?: boolean;
  apiLatencySpike?: boolean;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface AggregatedTrace {
  timeline: TracePoint[];
  correlatedAnomalies: CorrelatedAnomaly[];
  sessionStats: {
    startTime: Date;
    endTime: Date;
    durationMs: number;
    dataPoints: number;
  };
}

@Injectable()
export class TraceAggregator {
  /**
   * Merge all collector outputs into a unified time-series trace.
   */
  aggregate(data: {
    cpuSamples: CpuSample[];
    memorySamples: MemorySample[];
    querySamples: QuerySample[];
    apiSamples: ApiSample[];
    windowMs?: number;
  }): AggregatedTrace {
    const { cpuSamples, memorySamples, querySamples, apiSamples, windowMs = 5000 } = data;

    const allTimestamps = [
      ...cpuSamples.map((s) => s.timestamp.getTime()),
      ...memorySamples.map((s) => s.timestamp.getTime()),
    ];

    if (!allTimestamps.length) {
      return {
        timeline: [],
        correlatedAnomalies: [],
        sessionStats: {
          startTime: new Date(),
          endTime: new Date(),
          durationMs: 0,
          dataPoints: 0,
        },
      };
    }

    const start = Math.min(...allTimestamps);
    const end = Math.max(...allTimestamps);

    const timeline: TracePoint[] = [];
    const windowCount = Math.ceil((end - start) / windowMs) || 1;

    for (let i = 0; i <= windowCount; i++) {
      const windowStart = start + i * windowMs;
      const windowEnd = windowStart + windowMs;

      const windowCpu = cpuSamples.filter(
        (s) =>
          s.timestamp.getTime() >= windowStart && s.timestamp.getTime() < windowEnd,
      );
      const windowMem = memorySamples.filter(
        (s) =>
          s.timestamp.getTime() >= windowStart && s.timestamp.getTime() < windowEnd,
      );
      const windowQueries = querySamples.filter(
        (s) =>
          s.timestamp.getTime() >= windowStart && s.timestamp.getTime() < windowEnd,
      );
      const windowApi = apiSamples.filter(
        (s) =>
          s.timestamp.getTime() >= windowStart && s.timestamp.getTime() < windowEnd,
      );

      if (!windowCpu.length && !windowMem.length) continue;

      const point: TracePoint = {
        timestamp: new Date(windowStart),
      };

      if (windowCpu.length) {
        point.cpuPercent =
          Math.round(
            (windowCpu.reduce((a, s) => a + s.snapshot.usagePercent, 0) /
              windowCpu.length) *
              100,
          ) / 100;
      }

      if (windowMem.length) {
        point.heapMb =
          Math.round(
            (windowMem.reduce((a, s) => a + s.snapshot.heapUsedMb, 0) /
              windowMem.length) *
              100,
          ) / 100;
      }

      if (windowQueries.length) {
        point.activeQueries = windowQueries.length;
      }

      if (windowApi.length) {
        point.apiRequestsPerSec =
          Math.round((windowApi.length / (windowMs / 1000)) * 100) / 100;
      }

      timeline.push(point);
    }

    const correlatedAnomalies = this.detectCorrelatedAnomalies(timeline, {
      cpuSamples,
      memorySamples,
      querySamples,
      apiSamples,
      windowMs,
    });

    return {
      timeline,
      correlatedAnomalies,
      sessionStats: {
        startTime: new Date(start),
        endTime: new Date(end),
        durationMs: end - start,
        dataPoints: timeline.length,
      },
    };
  }

  private detectCorrelatedAnomalies(
    timeline: TracePoint[],
    raw: {
      cpuSamples: CpuSample[];
      memorySamples: MemorySample[];
      querySamples: QuerySample[];
      apiSamples: ApiSample[];
      windowMs: number;
    },
  ): CorrelatedAnomaly[] {
    const anomalies: CorrelatedAnomaly[] = [];
    if (timeline.length < 3) return anomalies;

    const cpuValues = timeline.map((t) => t.cpuPercent ?? 0);
    const heapValues = timeline.map((t) => t.heapMb ?? 0);

    const cpuMean = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length;
    const cpuStd = this.stdDev(cpuValues);
    const heapMean = heapValues.reduce((a, b) => a + b, 0) / heapValues.length;
    const heapStd = this.stdDev(heapValues);

    for (let i = 1; i < timeline.length - 1; i++) {
      const point = timeline[i];
      const conditions: string[] = [];
      let maxSeverity: 'low' | 'medium' | 'high' | 'critical' = 'low';

      const cpuSpike =
        (point.cpuPercent ?? 0) > cpuMean + 2 * cpuStd &&
        (point.cpuPercent ?? 0) > 60;
      const memSpike =
        (point.heapMb ?? 0) > heapMean + 2 * heapStd &&
        (point.heapMb ?? 0) > 200;
      const querySpike = (point.activeQueries ?? 0) > 20;
      const apiSpike = (point.apiRequestsPerSec ?? 0) > 100;

      if (cpuSpike) {
        conditions.push(`CPU spike: ${point.cpuPercent?.toFixed(1)}%`);
        maxSeverity = this.elevate(maxSeverity, 'high');
      }
      if (memSpike) {
        conditions.push(`Memory spike: ${point.heapMb?.toFixed(1)} MB`);
        maxSeverity = this.elevate(maxSeverity, 'medium');
      }
      if (querySpike) {
        conditions.push(`Query burst: ${point.activeQueries} queries`);
        maxSeverity = this.elevate(maxSeverity, 'medium');
      }
      if (apiSpike) {
        conditions.push(`API burst: ${point.apiRequestsPerSec?.toFixed(1)} req/s`);
        maxSeverity = this.elevate(maxSeverity, 'low');
      }

      const correlated = [cpuSpike, memSpike, querySpike, apiSpike].filter(Boolean).length;
      if (correlated >= 2) maxSeverity = this.elevate(maxSeverity, 'critical');

      if (conditions.length >= 1) {
        anomalies.push({
          timestamp: point.timestamp,
          windowMs: raw.windowMs,
          cpuSpike,
          memorySpike: memSpike,
          querySpike,
          apiLatencySpike: apiSpike,
          description: conditions.join('; '),
          severity: maxSeverity,
        });
      }
    }

    return anomalies;
  }

  private stdDev(values: number[]): number {
    if (!values.length) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private elevate(
    current: 'low' | 'medium' | 'high' | 'critical',
    candidate: 'low' | 'medium' | 'high' | 'critical',
  ): 'low' | 'medium' | 'high' | 'critical' {
    const order = ['low', 'medium', 'high', 'critical'];
    return order.indexOf(candidate) > order.indexOf(current) ? candidate : current;
  }
}
