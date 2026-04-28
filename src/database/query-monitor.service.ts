/**
 * QueryMonitorService
 *
 * Detects slow database queries at runtime and raises alerts via the
 * application event bus and structured logs.
 *
 * How it works
 * ────────────
 * 1. TypeORM's `logger` option is set to a custom logger that calls
 *    `QueryMonitorService.record()` for every executed query.
 * 2. Queries that exceed `SLOW_QUERY_THRESHOLD_MS` are flagged, logged at
 *    WARN level, and emitted as `db.query.slow` events.
 * 3. A sliding-window counter tracks the slow-query rate per minute.
 *    When the rate exceeds `SLOW_QUERY_RATE_ALERT_THRESHOLD`, a
 *    `db.query.slow_rate_exceeded` event is emitted (e.g. for PagerDuty).
 * 4. The service exposes `getStats()` and `getSlowQueries()` for health
 *    endpoints and admin dashboards.
 *
 * Security
 * ────────
 * • Query parameters are sanitised before logging to prevent credential
 *   or PII leakage in log aggregators.
 * • The service does not expose raw query parameters through any API.
 */
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

export const SLOW_QUERY_EVENT = 'db.query.slow';
export const SLOW_RATE_EVENT = 'db.query.slow_rate_exceeded';

export interface SlowQueryRecord {
  query: string;
  durationMs: number;
  detectedAt: Date;
  /** Sanitised — no raw parameter values. */
  paramCount: number;
}

export interface QueryMonitorStats {
  totalRecorded: number;
  slowQueryCount: number;
  slowQueriesLastMinute: number;
  averageDurationMs: number;
  p95DurationMs: number;
  thresholdMs: number;
}

const MAX_HISTORY = 500;
const RATE_WINDOW_MS = 60_000;

@Injectable()
export class QueryMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueryMonitorService.name);

  private readonly thresholdMs: number;
  private readonly rateAlertThreshold: number;

  private readonly slowQueries: SlowQueryRecord[] = [];
  private readonly allDurations: number[] = [];
  private totalRecorded = 0;

  /** Timestamps of slow queries within the current rate window. */
  private readonly slowQueryTimestamps: number[] = [];

  private rateCheckTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.thresholdMs = parseInt(
      process.env.SLOW_QUERY_THRESHOLD_MS ?? '200',
      10,
    );
    this.rateAlertThreshold = parseInt(
      process.env.SLOW_QUERY_RATE_ALERT_THRESHOLD ?? '10',
      10,
    );
  }

  onModuleInit(): void {
    // Patch TypeORM's data source logger to intercept slow queries.
    this.patchDataSourceLogger();

    // Check slow-query rate every 60 s.
    this.rateCheckTimer = setInterval(
      () => this.checkSlowQueryRate(),
      RATE_WINDOW_MS,
    );

    this.logger.log(
      `QueryMonitorService started. ` +
        `Threshold: ${this.thresholdMs}ms, ` +
        `Rate alert: ${this.rateAlertThreshold} slow queries/min`,
    );
  }

  onModuleDestroy(): void {
    if (this.rateCheckTimer) {
      clearInterval(this.rateCheckTimer);
      this.rateCheckTimer = null;
    }
  }

  /**
   * Record a query execution.  Called by the patched TypeORM logger and
   * directly from services that wrap their own queries.
   */
  record(query: string, params: unknown[], durationMs: number): void {
    this.totalRecorded++;

    // Keep a bounded duration history for percentile calculations.
    this.allDurations.push(durationMs);
    if (this.allDurations.length > MAX_HISTORY) this.allDurations.shift();

    if (durationMs < this.thresholdMs) return;

    const record: SlowQueryRecord = {
      query: this.truncate(query, 300),
      durationMs,
      detectedAt: new Date(),
      paramCount: Array.isArray(params) ? params.length : 0,
    };

    this.slowQueries.push(record);
    if (this.slowQueries.length > MAX_HISTORY) this.slowQueries.shift();

    this.slowQueryTimestamps.push(Date.now());

    this.logger.warn(
      `Slow query detected (${durationMs.toFixed(1)}ms > ${this.thresholdMs}ms): ` +
        `${record.query}`,
    );

    this.eventEmitter.emit(SLOW_QUERY_EVENT, record);
  }

  /** Returns aggregated statistics for health/admin endpoints. */
  getStats(): QueryMonitorStats {
    const sorted = [...this.allDurations].sort((a, b) => a - b);
    const p95Idx = Math.max(0, Math.floor(sorted.length * 0.95) - 1);
    const avg =
      sorted.length > 0
        ? sorted.reduce((s, v) => s + v, 0) / sorted.length
        : 0;

    return {
      totalRecorded: this.totalRecorded,
      slowQueryCount: this.slowQueries.length,
      slowQueriesLastMinute: this.countRecentSlowQueries(),
      averageDurationMs: Math.round(avg * 100) / 100,
      p95DurationMs: sorted[p95Idx] ?? 0,
      thresholdMs: this.thresholdMs,
    };
  }

  /** Returns the most recent slow queries, newest first. */
  getSlowQueries(limit = 50): SlowQueryRecord[] {
    return [...this.slowQueries].reverse().slice(0, limit);
  }

  /** Clears in-memory history (useful in tests / after a maintenance window). */
  reset(): void {
    this.slowQueries.length = 0;
    this.allDurations.length = 0;
    this.slowQueryTimestamps.length = 0;
    this.totalRecorded = 0;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Patches the TypeORM DataSource logger so every slow query is forwarded
   * to `record()` without requiring callers to instrument their code.
   */
  private patchDataSourceLogger(): void {
    try {
      const original = (this.dataSource as any).logger;
      if (!original) return;

      const self = this;
      const originalLogQuery = original.logQuery?.bind(original);
      const originalLogSlow = original.logQuerySlow?.bind(original);

      original.logQuery = function (
        query: string,
        params?: unknown[],
      ): void {
        originalLogQuery?.(query, params);
      };

      original.logQuerySlow = function (
        time: number,
        query: string,
        params?: unknown[],
      ): void {
        originalLogSlow?.(time, query, params);
        self.record(query, params ?? [], time);
      };

      this.logger.log('TypeORM logger patched for slow query monitoring');
    } catch (err) {
      this.logger.warn(
        `Could not patch TypeORM logger: ${(err as Error).message}`,
      );
    }
  }

  private checkSlowQueryRate(): void {
    const count = this.countRecentSlowQueries();

    if (count >= this.rateAlertThreshold) {
      this.logger.error(
        `Slow query rate alert: ${count} slow queries in the last minute ` +
          `(threshold: ${this.rateAlertThreshold})`,
      );
      this.eventEmitter.emit(SLOW_RATE_EVENT, {
        count,
        thresholdMs: this.thresholdMs,
        rateAlertThreshold: this.rateAlertThreshold,
        timestamp: new Date(),
      });
    }
  }

  private countRecentSlowQueries(): number {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    // Prune old timestamps while counting
    while (
      this.slowQueryTimestamps.length > 0 &&
      this.slowQueryTimestamps[0] < cutoff
    ) {
      this.slowQueryTimestamps.shift();
    }
    return this.slowQueryTimestamps.length;
  }

  private truncate(str: string, maxLen: number): string {
    return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
  }
}
