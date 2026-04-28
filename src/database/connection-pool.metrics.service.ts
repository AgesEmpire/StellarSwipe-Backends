import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrometheusService } from '../monitoring/metrics/prometheus.service';

export interface PoolSnapshot {
  total: number;
  active: number;
  idle: number;
  waiting: number;
  utilizationRatio: number;
  timestamp: Date;
}

export const POOL_EVENTS = {
  SATURATION: 'db.pool.saturation',
  HIGH_UTILIZATION: 'db.pool.high_utilization',
  LEAK_SUSPECTED: 'db.pool.leak_suspected',
} as const;

@Injectable()
export class ConnectionPoolMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectionPoolMetricsService.name);

  private readonly poolMax: number;
  private readonly saturationThreshold: number;   // ratio — default 0.90
  private readonly highUtilizationThreshold: number; // ratio — default 0.75
  private readonly pollIntervalMs: number;

  private pollTimer: NodeJS.Timeout | null = null;
  private lastSnapshot: PoolSnapshot | null = null;
  private consecutiveHighUtilization = 0;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly prometheus: PrometheusService,
  ) {
    this.poolMax = parseInt(process.env.DATABASE_POOL_MAX || '30', 10);
    this.saturationThreshold = parseFloat(process.env.DB_POOL_SATURATION_THRESHOLD || '0.90');
    this.highUtilizationThreshold = parseFloat(process.env.DB_POOL_HIGH_UTIL_THRESHOLD || '0.75');
    this.pollIntervalMs = parseInt(process.env.DB_POOL_POLL_INTERVAL_MS || '15000', 10);
  }

  onModuleInit(): void {
    this.pollTimer = setInterval(() => this.collect(), this.pollIntervalMs);
    this.logger.log(
      `Connection pool metrics polling started (interval=${this.pollIntervalMs}ms, max=${this.poolMax})`,
    );
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async collect(): Promise<PoolSnapshot> {
    try {
      const [activityRow] = await this.dataSource.query<{ active: string; idle: string; waiting: string }[]>(`
        SELECT
          COUNT(*) FILTER (WHERE state = 'active')  AS active,
          COUNT(*) FILTER (WHERE state = 'idle')    AS idle,
          COUNT(*) FILTER (WHERE wait_event_type = 'Lock' OR wait_event_type = 'Client') AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database()
      `);

      const active = parseInt(activityRow.active, 10);
      const idle = parseInt(activityRow.idle, 10);
      const waiting = parseInt(activityRow.waiting, 10);
      const total = active + idle;
      const utilizationRatio = this.poolMax > 0 ? total / this.poolMax : 0;

      const snapshot: PoolSnapshot = { total, active, idle, waiting, utilizationRatio, timestamp: new Date() };
      this.lastSnapshot = snapshot;

      // Update Prometheus gauges
      this.prometheus.dbPoolTotal.set(total);
      this.prometheus.dbPoolActive.set(active);
      this.prometheus.dbPoolIdle.set(idle);
      this.prometheus.dbPoolWaiting.set(waiting);
      this.prometheus.dbPoolUtilizationRatio.set(utilizationRatio);

      this.checkThresholds(snapshot);
      return snapshot;
    } catch (error) {
      this.logger.error(`Failed to collect pool metrics: ${(error as Error).message}`);
      return this.lastSnapshot ?? this.emptySnapshot();
    }
  }

  getLastSnapshot(): PoolSnapshot | null {
    return this.lastSnapshot;
  }

  private checkThresholds(snapshot: PoolSnapshot): void {
    const { utilizationRatio, waiting } = snapshot;

    if (utilizationRatio >= this.saturationThreshold) {
      this.logger.warn(
        `DB pool near saturation: ${(utilizationRatio * 100).toFixed(1)}% (${snapshot.total}/${this.poolMax})`,
      );
      this.eventEmitter.emit(POOL_EVENTS.SATURATION, snapshot);
    }

    if (utilizationRatio >= this.highUtilizationThreshold) {
      this.consecutiveHighUtilization++;

      if (this.consecutiveHighUtilization >= 3) {
        this.logger.warn(
          `DB pool high utilization for ${this.consecutiveHighUtilization} consecutive polls`,
        );
        this.eventEmitter.emit(POOL_EVENTS.HIGH_UTILIZATION, {
          ...snapshot,
          consecutivePolls: this.consecutiveHighUtilization,
        });
      }
    } else {
      this.consecutiveHighUtilization = 0;
    }

    // Waiting connections with low utilization suggests a connection leak
    if (waiting > 0 && utilizationRatio < this.highUtilizationThreshold) {
      this.logger.warn(`Possible connection leak: ${waiting} waiting with only ${(utilizationRatio * 100).toFixed(1)}% utilization`);
      this.eventEmitter.emit(POOL_EVENTS.LEAK_SUSPECTED, snapshot);
    }
  }

  private emptySnapshot(): PoolSnapshot {
    return { total: 0, active: 0, idle: 0, waiting: 0, utilizationRatio: 0, timestamp: new Date() };
  }
}
