import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Bounded label values for pool metrics. Using a fixed enum of states keeps
 * label cardinality constant regardless of how many pools exist.
 */
export type PoolState = 'idle' | 'active' | 'waiting';

/**
 * Configurable saturation thresholds. `saturation` is the ratio of in-use
 * connections to the pool's max size (0..1).
 */
export interface PoolAlertThresholds {
  /** Utilization ratio at which the pool is considered under pressure. */
  warning: number;
  /** Utilization ratio at which the pool is considered saturated. */
  critical: number;
}

export const DEFAULT_POOL_ALERT_THRESHOLDS: PoolAlertThresholds = {
  warning: 0.75,
  critical: 0.9,
};

/**
 * Snapshot of a single connection pool, as reported by the driver.
 */
export interface PoolSnapshot {
  /** Stable, low-cardinality pool identifier (e.g. "primary", "replica"). */
  name: string;
  /** Maximum number of connections the pool may open. */
  max: number;
  /** Connections currently checked out. */
  active: number;
  /** Connections currently idle in the pool. */
  idle: number;
  /** Callers waiting for a connection. */
  waiting: number;
}

/**
 * Evaluates pool pressure against configurable thresholds.
 * Exported so it can be unit tested without a running registry.
 */
export function evaluatePoolSaturation(
  snapshot: PoolSnapshot,
  thresholds: PoolAlertThresholds = DEFAULT_POOL_ALERT_THRESHOLDS,
): { saturation: number; level: 'ok' | 'warning' | 'critical' } {
  const saturation = snapshot.max > 0 ? snapshot.active / snapshot.max : 0;
  let level: 'ok' | 'warning' | 'critical' = 'ok';
  if (saturation >= thresholds.critical) {
    level = 'critical';
  } else if (saturation >= thresholds.warning) {
    level = 'warning';
  }
  return { saturation, level };
}

@Injectable()
export class MetricsService {
  private readonly registry: Registry;

  private readonly poolConnections: Gauge<string>;
  private readonly poolSaturation: Gauge<string>;
  private readonly poolWaiting: Gauge<string>;
  private readonly poolSaturationAlerts: Counter<string>;
  private readonly poolAcquireDuration: Histogram<string>;

  private thresholds: PoolAlertThresholds;

  constructor(thresholds: PoolAlertThresholds = DEFAULT_POOL_ALERT_THRESHOLDS) {
    this.thresholds = thresholds;
    this.registry = new Registry();

    this.poolConnections = new Gauge({
      name: 'db_pool_connections',
      help: 'Number of database pool connections by state',
      labelNames: ['pool', 'state'] as const,
      registers: [this.registry],
    });

    this.poolSaturation = new Gauge({
      name: 'db_pool_saturation_ratio',
      help: 'Database pool utilization ratio (active / max)',
      labelNames: ['pool'] as const,
      registers: [this.registry],
    });

    this.poolWaiting = new Gauge({
      name: 'db_pool_waiting_requests',
      help: 'Number of callers waiting for a database connection',
      labelNames: ['pool'] as const,
      registers: [this.registry],
    });

    this.poolSaturationAlerts = new Counter({
      name: 'db_pool_saturation_alerts_total',
      help: 'Number of times a pool crossed a saturation threshold',
      labelNames: ['pool', 'level'] as const,
      registers: [this.registry],
    });

    this.poolAcquireDuration = new Histogram({
      name: 'db_pool_acquire_duration_seconds',
      help: 'Time spent waiting to acquire a database connection',
      labelNames: ['pool'] as const,
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
      registers: [this.registry],
    });
  }

  /**
   * Updates the configured alert thresholds at runtime.
   */
  setPoolAlertThresholds(thresholds: PoolAlertThresholds): void {
    this.thresholds = thresholds;
  }

  getPoolAlertThresholds(): PoolAlertThresholds {
    return this.thresholds;
  }

  /**
   * Records a pool snapshot and emits saturation alerts when thresholds are
   * crossed. Label values are bounded: `pool` is a stable name and `state`
   * comes from the fixed PoolState union.
   */
  observePool(snapshot: PoolSnapshot): void {
    const states: Record<PoolState, number> = {
      idle: snapshot.idle,
      active: snapshot.active,
      waiting: snapshot.waiting,
    };

    (Object.keys(states) as PoolState[]).forEach((state) => {
      this.poolConnections.set({ pool: snapshot.name, state }, states[state]);
    });

    this.poolWaiting.set({ pool: snapshot.name }, snapshot.waiting);

    const { saturation, level } = evaluatePoolSaturation(snapshot, this.thresholds);
    this.poolSaturation.set({ pool: snapshot.name }, saturation);

    if (level !== 'ok') {
      this.poolSaturationAlerts.inc({ pool: snapshot.name, level });
    }
  }

  /**
   * Records how long a caller waited to acquire a connection.
   */
  observePoolAcquireDuration(pool: string, seconds: number): void {
    this.poolAcquireDuration.observe({ pool }, seconds);
  }

  getRegistry(): Registry {
    return this.registry;
  }
}
