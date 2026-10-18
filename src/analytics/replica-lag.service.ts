import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface ReplicaLagStatus {
  lagMs: number;
  withinPolicy: boolean;
  measuredAt: Date;
}

/**
 * Issue #1371 — Route analytics reads based on read-replica lag.
 *
 * Measures Postgres streaming-replication lag on the analytics read
 * replica and exposes a policy decision ("is the replica fresh enough to
 * serve a freshness-sensitive read right now") so callers never have to
 * reason about `pg_last_xact_replay_timestamp()` themselves.
 *
 * The lag measurement is cached briefly so a burst of reads doesn't each
 * issue their own probe query against the replica.
 */
@Injectable()
export class ReplicaLagService {
  private readonly logger = new Logger(ReplicaLagService.name);
  private cached: ReplicaLagStatus | null = null;

  /** How long a lag measurement may be reused before re-probing the replica. */
  private readonly cacheTtlMs = 1000;

  constructor(
    @InjectDataSource('replica')
    private readonly replicaDataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  private get maxLagMs(): number {
    return this.configService.get<number>('database.replica.maxLagMs') ?? 5000;
  }

  /**
   * Measures current replication lag, in milliseconds, as observed from the
   * replica connection itself.
   *
   * - `pg_is_in_recovery() = false` means this connection isn't actually a
   *   standby (e.g. replica and primary point at the same instance in a
   *   single-node environment) — lag is defined as 0 in that case.
   * - `pg_last_xact_replay_timestamp()` returns NULL before the standby has
   *   replayed anything yet — also treated as 0 (nothing to be behind on).
   *
   * On any query failure the lag is reported as +Infinity so policy checks
   * fail safe towards routing freshness-sensitive reads to the primary
   * rather than trusting a replica we couldn't even measure.
   */
  async getLagMs(): Promise<number> {
    try {
      const rows = await this.replicaDataSource.query(
        `SELECT CASE
           WHEN pg_is_in_recovery() = false THEN 0
           WHEN pg_last_xact_replay_timestamp() IS NULL THEN 0
           ELSE EXTRACT(EPOCH FROM (clock_timestamp() - pg_last_xact_replay_timestamp())) * 1000
         END AS lag_ms`,
      );
      const lagMs = Number(rows?.[0]?.lag_ms ?? 0);
      return Number.isFinite(lagMs) && lagMs >= 0 ? lagMs : 0;
    } catch (error) {
      this.logger.warn('Failed to measure replica lag; treating replica as stale', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return Number.POSITIVE_INFINITY;
    }
  }

  /**
   * Returns the current freshness status against the configured
   * `DATABASE_REPLICA_MAX_LAG_MS` policy, using the short-lived cache above.
   */
  async getStatus(forceRefresh = false): Promise<ReplicaLagStatus> {
    if (
      !forceRefresh &&
      this.cached &&
      Date.now() - this.cached.measuredAt.getTime() < this.cacheTtlMs
    ) {
      return this.cached;
    }

    const lagMs = await this.getLagMs();
    const status: ReplicaLagStatus = {
      lagMs,
      withinPolicy: lagMs <= this.maxLagMs,
      measuredAt: new Date(),
    };

    if (!status.withinPolicy) {
      this.logger.warn(
        `Replica lag ${lagMs}ms exceeds policy limit ${this.maxLagMs}ms — freshness-sensitive reads will fall back to the primary`,
      );
    }

    this.cached = status;
    return status;
  }

  /** Convenience helper: true when the replica is fresh enough to read from. */
  async isWithinPolicy(): Promise<boolean> {
    const status = await this.getStatus();
    return status.withinPolicy;
  }
}
