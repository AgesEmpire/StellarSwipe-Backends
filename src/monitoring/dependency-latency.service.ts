import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrometheusService } from './metrics/prometheus.service';
import { Histogram, Gauge, Counter } from 'prom-client';

export enum DependencyType {
  DATABASE = 'database',
  CACHE = 'cache',
  STELLAR_HORIZON = 'stellar_horizon',
  STELLAR_SOROBAN = 'stellar_soroban',
  EXTERNAL_HTTP = 'external_http',
  QUEUE = 'queue',
  STORAGE = 'storage',
}

export enum DependencyStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
  UNKNOWN = 'unknown',
}

export interface DependencySnapshot {
  name: string;
  type: DependencyType;
  status: DependencyStatus;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
  totalCalls: number;
  checkedAt: Date;
}

interface LatencySample {
  durationMs: number;
  success: boolean;
  timestamp: number;
}

interface DependencyState {
  samples: LatencySample[];
  totalCalls: number;
  totalErrors: number;
}

@Injectable()
export class DependencyLatencyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DependencyLatencyService.name);

  private latencyHistogram: Histogram;
  private dependencyStatusGauge: Gauge;
  private dependencyErrorsCounter: Counter;
  private dependencyCallsCounter: Counter;

  private readonly states = new Map<string, DependencyState>();
  // Keep last 10 minutes of samples per dependency
  private readonly retentionMs = 10 * 60 * 1000;
  private readonly degradedThresholdMs: number;
  private readonly unhealthyThresholdMs: number;
  private readonly unhealthyErrorRate: number;

  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(
    private readonly configService: ConfigService,
    private readonly prometheus: PrometheusService,
  ) {
    this.degradedThresholdMs = configService.get<number>('monitoring.degradedThresholdMs', 500);
    this.unhealthyThresholdMs = configService.get<number>('monitoring.unhealthyThresholdMs', 2000);
    this.unhealthyErrorRate = configService.get<number>('monitoring.unhealthyErrorRate', 0.1);
  }

  onModuleInit(): void {
    this.latencyHistogram = new Histogram({
      name: 'dependency_latency_seconds',
      help: 'Latency of external dependency calls in seconds',
      labelNames: ['dependency', 'type', 'success'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.prometheus.registry],
    });

    this.dependencyStatusGauge = new Gauge({
      name: 'dependency_status',
      help: 'Current health status of external dependencies (0=healthy, 1=degraded, 2=unhealthy)',
      labelNames: ['dependency', 'type'],
      registers: [this.prometheus.registry],
    });

    this.dependencyErrorsCounter = new Counter({
      name: 'dependency_errors_total',
      help: 'Total errors when calling external dependencies',
      labelNames: ['dependency', 'type'],
      registers: [this.prometheus.registry],
    });

    this.dependencyCallsCounter = new Counter({
      name: 'dependency_calls_total',
      help: 'Total calls to external dependencies',
      labelNames: ['dependency', 'type'],
      registers: [this.prometheus.registry],
    });

    this.cleanupInterval = setInterval(() => this.pruneOldSamples(), 60_000);
    this.logger.log('DependencyLatencyService initialized');
  }

  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Wraps an async operation and records its latency and success/failure.
   */
  async measure<T>(
    name: string,
    type: DependencyType,
    operation: () => Promise<T>,
  ): Promise<T> {
    const start = performance.now();
    let success = true;

    try {
      const result = await operation();
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const durationMs = performance.now() - start;
      this.record(name, type, durationMs, success);
    }
  }

  record(
    name: string,
    type: DependencyType,
    durationMs: number,
    success: boolean,
  ): void {
    const durationSeconds = durationMs / 1000;
    const labels = { dependency: name, type };

    this.latencyHistogram.observe({ ...labels, success: String(success) }, durationSeconds);
    this.dependencyCallsCounter.inc(labels);

    if (!success) {
      this.dependencyErrorsCounter.inc(labels);
    }

    this.updateState(name, type, durationMs, success);
  }

  getSnapshot(name: string, type: DependencyType): DependencySnapshot {
    const state = this.states.get(this.stateKey(name, type));
    if (!state || state.samples.length === 0) {
      return {
        name,
        type,
        status: DependencyStatus.UNKNOWN,
        p50Ms: 0,
        p95Ms: 0,
        p99Ms: 0,
        errorRate: 0,
        totalCalls: 0,
        checkedAt: new Date(),
      };
    }

    const durations = state.samples.map((s) => s.durationMs).sort((a, b) => a - b);
    const errorRate = state.totalCalls > 0 ? state.totalErrors / state.totalCalls : 0;
    const p50 = this.percentile(durations, 50);
    const p95 = this.percentile(durations, 95);
    const p99 = this.percentile(durations, 99);

    const status = this.deriveStatus(p95, errorRate);
    this.updateStatusGauge(name, type, status);

    return {
      name,
      type,
      status,
      p50Ms: Math.round(p50),
      p95Ms: Math.round(p95),
      p99Ms: Math.round(p99),
      errorRate: Math.round(errorRate * 10000) / 100,
      totalCalls: state.totalCalls,
      checkedAt: new Date(),
    };
  }

  getAllSnapshots(): DependencySnapshot[] {
    return Array.from(this.states.keys()).map((key) => {
      const [name, type] = key.split(':') as [string, DependencyType];
      return this.getSnapshot(name, type);
    });
  }

  isDegraded(name: string, type: DependencyType): boolean {
    const snap = this.getSnapshot(name, type);
    return snap.status !== DependencyStatus.HEALTHY && snap.status !== DependencyStatus.UNKNOWN;
  }

  private updateState(
    name: string,
    type: DependencyType,
    durationMs: number,
    success: boolean,
  ): void {
    const key = this.stateKey(name, type);
    let state = this.states.get(key);
    if (!state) {
      state = { samples: [], totalCalls: 0, totalErrors: 0 };
      this.states.set(key, state);
    }

    state.samples.push({ durationMs, success, timestamp: Date.now() });
    state.totalCalls++;
    if (!success) state.totalErrors++;
  }

  private deriveStatus(p95Ms: number, errorRate: number): DependencyStatus {
    if (errorRate >= this.unhealthyErrorRate || p95Ms >= this.unhealthyThresholdMs) {
      return DependencyStatus.UNHEALTHY;
    }
    if (p95Ms >= this.degradedThresholdMs) {
      return DependencyStatus.DEGRADED;
    }
    return DependencyStatus.HEALTHY;
  }

  private updateStatusGauge(name: string, type: DependencyType, status: DependencyStatus): void {
    const value =
      status === DependencyStatus.HEALTHY ? 0 :
      status === DependencyStatus.DEGRADED ? 1 : 2;
    this.dependencyStatusGauge.set({ dependency: name, type }, value);
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  private pruneOldSamples(): void {
    const cutoff = Date.now() - this.retentionMs;
    for (const state of this.states.values()) {
      state.samples = state.samples.filter((s) => s.timestamp >= cutoff);
    }
  }

  private stateKey(name: string, type: DependencyType): string {
    return `${name}:${type}`;
  }
}
