import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { PrometheusService } from '../monitoring/metrics/prometheus.service';

export interface PoolSnapshot {
  total: number;
  active: number;
  idle: number;
  pending: number;
  timedOut: number;
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
  private poolInstrumented = false;
  private lastSnapshot: PoolSnapshot | null = null;
  private timedOut = 0;
  private consecutiveHighUtilization = 0;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly prometheus: PrometheusService,
    private readonly configService: ConfigService,
  ) {
    this.poolMax = parseInt(this.configService.get<string>('DATABASE_POOL_MAX') || '30', 10);
    this.saturationThreshold = parseFloat(this.configService.get<string>('DB_POOL_SATURATION_THRESHOLD') || '0.90');
    this.highUtilizationThreshold = parseFloat(this.configService.get<string>('DB_POOL_HIGH_UTIL_THRESHOLD') || '0.75');
    this.pollIntervalMs = parseInt(this.configService.get<string>('DB_POOL_POLL_INTERVAL_MS') || '15000', 10);
  }

  onModuleInit(): void {
    this.instrumentPoolTimeouts();
    void this.collect();
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
      const pool = (this.dataSource.driver as { master?: {
        totalCount?: number;
        idleCount?: number;
        waitingCount?: number;
      } }).master;
      if (!pool) {
        throw new Error('PostgreSQL connection pool is unavailable');
      }

      const total = pool.totalCount ?? 0;
      const idle = pool.idleCount ?? 0;
      const active = Math.max(total - idle, 0);
      const pending = pool.waitingCount ?? 0;
      const utilizationRatio = this.poolMax > 0 ? total / this.poolMax : 0;

      const snapshot: PoolSnapshot = {
        total,
        active,
        idle,
        pending,
        timedOut: this.timedOut,
        utilizationRatio,
        timestamp: new Date(),
      };
      this.lastSnapshot = snapshot;

      // Update Prometheus gauges
      this.prometheus.dbPoolTotal.set(total);
      this.prometheus.dbPoolActive.set(active);
      this.prometheus.dbPoolIdle.set(idle);
      this.prometheus.dbPoolPending.set(pending);
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

  recordAcquireTimeout(): void {
    this.timedOut++;
    this.prometheus.dbPoolAcquireTimeoutsTotal.inc();
  }

  private instrumentPoolTimeouts(): void {
    const pool = (this.dataSource.driver as { master?: { connect?: Function } }).master;
    if (!pool?.connect || this.poolInstrumented) return;

    const connect = pool.connect.bind(pool);
    pool.connect = (...args: unknown[]) => {
      const result = connect(...args);
      if (!result || typeof (result as Promise<unknown>).catch !== 'function') return result;
      return (result as Promise<unknown>).catch((error) => {
        if (/timeout|timed out/i.test((error as Error).message)) {
          this.recordAcquireTimeout();
        }
        throw error;
      });
    };
    this.poolInstrumented = true;
  }

  isReady(): boolean {
    const snapshot = this.lastSnapshot;
    return snapshot !== null && snapshot.utilizationRatio < 1 && snapshot.pending === 0;
  }

  private checkThresholds(snapshot: PoolSnapshot): void {
    const { utilizationRatio, pending } = snapshot;

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
    if (pending > 0 && utilizationRatio < this.highUtilizationThreshold) {
      this.logger.warn(`Possible connection leak: ${pending} pending with only ${(utilizationRatio * 100).toFixed(1)}% utilization`);
      this.eventEmitter.emit(POOL_EVENTS.LEAK_SUSPECTED, snapshot);
    }
  }

  private emptySnapshot(): PoolSnapshot {
    return { total: 0, active: 0, idle: 0, pending: 0, timedOut: this.timedOut, utilizationRatio: 0, timestamp: new Date() };
  }
}
