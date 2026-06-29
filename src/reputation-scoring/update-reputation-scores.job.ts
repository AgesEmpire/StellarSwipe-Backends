import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  ReputationScoringService,
  ProviderMetrics,
} from '../services/reputation-scoring.service';
import { DistributedLockService } from '../common/services/distributed-lock.service';

const LOCK_KEY = 'update-reputation-scores';
const LOCK_TTL_MS = 10 * 60 * 1000; // 10 min — job normally runs in < 5 min

/**
 * Raw row returned by the provider metrics aggregation query.
 * Adjust the table/column names to match your actual schema.
 */
interface ProviderMetricsRow {
  provider_id: string;
  total_signals: string;
  winning_signals: string;
  total_copiers: string;
  active_copiers: string;
  stake_amount: string;
  avg_rating: string;
  rating_count: string;
  active_days: string;
  active_days_last_30: string;
}

@Injectable()
export class UpdateReputationScoresJob {
  private readonly logger = new Logger(UpdateReputationScoresJob.name);

  constructor(
    private readonly reputationScoringService: ReputationScoringService,
    private readonly dataSource: DataSource,
    private readonly distributedLock: DistributedLockService,
  ) {}

  /**
   * Runs every day at 02:00 UTC to refresh all provider reputation scores.
   * The distributed lock ensures only one replica executes per scheduled tick.
   */
  @Cron('0 2 * * *', { name: 'update-reputation-scores', timeZone: 'UTC' })
  async handleCron(): Promise<void> {
    const { ran } = await this.distributedLock.withLock(
      LOCK_KEY,
      LOCK_TTL_MS,
      () => this.run(),
    );
    if (!ran) {
      this.logger.log('Skipping reputation score update — another replica is running it');
    }
  }

  private async run(): Promise<void> {
    this.logger.log('Starting daily reputation score update job');
    const startTime = Date.now();

    try {
      const metrics = await this.fetchAllProviderMetrics();

      if (metrics.length === 0) {
        this.logger.warn('No provider metrics found — skipping update');
        return;
      }

      await this.reputationScoringService.updateAllProviderScores(metrics);

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `Reputation score update finished in ${elapsed}s for ${metrics.length} providers`,
      );
    } catch (error) {
      this.logger.error('Reputation score update job failed', error);
      throw error;
    }
  }

  /**
   * Weekly full-recompute safeguard against incremental drift.
   * Runs every Sunday at 03:00 UTC.
   */
  @Cron('0 3 * * 0', { name: 'full-recompute-reputation-scores', timeZone: 'UTC' })
  async handleFullRecompute(): Promise<void> {
    const { ran } = await this.distributedLock.withLock(
      `${LOCK_KEY}:full-recompute`,
      LOCK_TTL_MS,
      () => this.runFullRecompute(),
    );
    if (!ran) {
      this.logger.log('Skipping full recompute — another replica is running it');
    }
  }

  private async runFullRecompute(): Promise<void> {
    this.logger.log('Starting weekly full reputation recompute (drift safeguard)');
    const startTime = Date.now();
    const metrics = await this.fetchAllProviderMetrics();

    if (metrics.length === 0) {
      this.logger.warn('No provider metrics found — skipping full recompute');
      return;
    }

    const results = await Promise.allSettled(
      metrics.map((m) => this.reputationScoringService.fullRecompute(m)),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.log(
      `Full recompute finished in ${elapsed}s: ${metrics.length - failed} succeeded, ${failed} failed`,
    );
  }

  /**
   * Allows manual triggering outside of the cron schedule
   * (e.g. via an admin endpoint or for backfilling).
   */
  async runManually(): Promise<{ updated: number; durationMs: number }> {
    const start = Date.now();
    const metrics = await this.fetchAllProviderMetrics();
    await this.reputationScoringService.updateAllProviderScores(metrics);
    return { updated: metrics.length, durationMs: Date.now() - start };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Aggregate all provider metrics in a single query.
   * Replace table/column names to match your actual schema.
   *
   * Expected tables:
   *   providers          – the provider registry
   *   signals            – trading signals posted by providers
   *   provider_copiers   – users who copied a provider
   *   provider_stakes    – on-chain stake records
   *   provider_ratings   – user ratings (1-5)
   */
  private async fetchAllProviderMetrics(): Promise<ProviderMetrics[]> {
    const rows: ProviderMetricsRow[] = await this.dataSource.query(`
      SELECT
        p.id                                                        AS provider_id,

        -- Signal stats
        COUNT(DISTINCT s.id)                                        AS total_signals,
        COUNT(DISTINCT s.id) FILTER (WHERE s.hit_target = true)    AS winning_signals,

        -- Copier stats
        COUNT(DISTINCT pc.user_id)                                  AS total_copiers,
        COUNT(DISTINCT pc.user_id)
          FILTER (WHERE pc.unfollowed_at IS NULL)                   AS active_copiers,

        -- Stake
        COALESCE(SUM(ps.amount), 0)                                AS stake_amount,

        -- Ratings
        COALESCE(AVG(pr.rating), 0)                                AS avg_rating,
        COUNT(pr.id)                                               AS rating_count,

        -- Activity age
        COALESCE(
          EXTRACT(DAY FROM NOW() - MIN(s.created_at)), 0
        )                                                          AS active_days,

        -- Consistency: distinct days with at least 1 signal in last 30d
        COUNT(DISTINCT DATE(s.created_at))
          FILTER (WHERE s.created_at >= NOW() - INTERVAL '30 days') AS active_days_last_30

      FROM providers p
      LEFT JOIN signals          s  ON s.provider_id   = p.id
      LEFT JOIN provider_copiers pc ON pc.provider_id  = p.id
      LEFT JOIN provider_stakes  ps ON ps.provider_id  = p.id
      LEFT JOIN provider_ratings pr ON pr.provider_id  = p.id
      GROUP BY p.id
    `);

    return rows.map((row) => ({
      providerId: row.provider_id,
      totalSignals: parseInt(row.total_signals, 10) || 0,
      winningSignals: parseInt(row.winning_signals, 10) || 0,
      totalCopiers: parseInt(row.total_copiers, 10) || 0,
      activeCopiers: parseInt(row.active_copiers, 10) || 0,
      stakeAmount: parseFloat(row.stake_amount) || 0,
      avgRating: parseFloat(row.avg_rating) || 0,
      ratingCount: parseInt(row.rating_count, 10) || 0,
      activeDays: parseInt(row.active_days, 10) || 0,
      activeDaysLast30: parseInt(row.active_days_last_30, 10) || 0,
    }));
  }
}
