import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ReputationScore } from '../entities/reputation-score.entity';

export interface ProviderMetrics {
  providerId: string;
  totalSignals: number;
  winningSignals: number;
  totalCopiers: number;
  activeCopiers: number;
  stakeAmount: number;
  avgRating: number;
  ratingCount: number;
  /** Days since first signal posted */
  activeDays: number;
  /** Number of days with at least one signal in the last 30 days */
  activeDaysLast30: number;
}

export interface ScoreBreakdown {
  score: number;
  smoothedScore: number;
  winRate: number;
  consistencyScore: number;
  retentionRate: number;
  stakeBonus: number;
  avgRating: number;
  isNewProvider: boolean;
}

// EMA smoothing factor (higher = more reactive to recent scores)
const EMA_ALPHA = 0.3;

// Minimum signals required before full scoring applies
const MIN_SIGNALS_FOR_FULL_SCORE = 10;

// Maximum stake that earns full bonus (in base units)
const MAX_STAKE_FOR_FULL_BONUS = 10_000;

// New provider threshold (days of activity)
const NEW_PROVIDER_DAYS = 30;

@Injectable()
export class ReputationScoringService {
  private readonly logger = new Logger(ReputationScoringService.name);

  constructor(
    @InjectRepository(ReputationScore)
    private readonly reputationScoreRepo: Repository<ReputationScore>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Calculate a composite reputation score (0-100) for a provider.
   * New providers with <10 signals receive a confidence-weighted score
   * to prevent gaming by inflating scores with small sample sizes.
   */
  calculateScore(metrics: ProviderMetrics): ScoreBreakdown {
    const isNewProvider =
      metrics.activeDays < NEW_PROVIDER_DAYS ||
      metrics.totalSignals < MIN_SIGNALS_FOR_FULL_SCORE;

    const winRate = this.calculateWinRate(metrics);
    const consistencyScore = this.calculateConsistency(metrics);
    const retentionRate = this.calculateRetentionRate(metrics);
    const stakeBonus = this.calculateStakeBonus(metrics.stakeAmount);
    const avgRating = this.normalizeRating(metrics.avgRating, metrics.ratingCount);

    let rawScore =
      winRate * 0.4 +
      consistencyScore * 0.2 +
      retentionRate * 0.2 +
      stakeBonus * 0.1 +
      avgRating * 0.1;

    // Apply confidence dampening for new providers
    if (isNewProvider) {
      const confidenceFactor = this.getConfidenceFactor(metrics);
      // Blend toward 50 (neutral) based on confidence
      rawScore = rawScore * confidenceFactor + 0.5 * (1 - confidenceFactor);
    }

    // Clamp to 0-1 range before scaling
    const clampedScore = Math.min(1, Math.max(0, rawScore));
    const score = parseFloat((clampedScore * 100).toFixed(2));

    return {
      score,
      smoothedScore: score, // Will be updated with EMA when persisted
      winRate: parseFloat((winRate * 100).toFixed(2)),
      consistencyScore: parseFloat((consistencyScore * 100).toFixed(2)),
      retentionRate: parseFloat((retentionRate * 100).toFixed(2)),
      stakeBonus: parseFloat((stakeBonus * 100).toFixed(2)),
      avgRating: parseFloat((avgRating * 100).toFixed(2)),
      isNewProvider,
    };
  }

  /**
   * Persist daily score snapshot and return the saved entity.
   * Applies EMA smoothing against the provider's previous score.
   */
  async updateProviderScore(metrics: ProviderMetrics): Promise<ReputationScore> {
    const breakdown = this.calculateScore(metrics);

    const previousScore = await this.reputationScoreRepo.findOne({
      where: { providerId: metrics.providerId },
      order: { recordedAt: 'DESC' },
    });

    const smoothedScore = previousScore
      ? this.applyEMA(previousScore.smoothedScore, breakdown.score)
      : breakdown.score;

    const record = this.reputationScoreRepo.create({
      providerId: metrics.providerId,
      score: breakdown.score,
      smoothedScore: parseFloat(smoothedScore.toFixed(2)),
      winRate: breakdown.winRate,
      consistencyScore: breakdown.consistencyScore,
      retentionRate: breakdown.retentionRate,
      stakeBonus: breakdown.stakeBonus,
      avgRating: breakdown.avgRating,
      totalSignals: metrics.totalSignals,
      winningSignals: metrics.winningSignals,
      totalCopiers: metrics.totalCopiers,
      activeCopiers: metrics.activeCopiers,
      stakeAmount: metrics.stakeAmount,
      ratingCount: metrics.ratingCount,
      activeDays: metrics.activeDays,
      isNewProvider: breakdown.isNewProvider,
      recordedAt: new Date(),
    });

    return this.reputationScoreRepo.save(record);
  }

  /**
   * Compute an incremental score update from a previous score record and a
   * single new signal outcome, avoiding a full history recompute.
   */
  calculateIncrementalScore(
    previous: {
      score: number;
      smoothedScore: number;
      totalSignals: number;
      winningSignals: number;
      totalCopiers: number;
      activeCopiers: number;
      stakeAmount: number;
      avgRating: number;
      ratingCount: number;
      activeDays: number;
      activeDaysLast30: number;
    },
    delta: { signalsDelta: number; winsDelta: number; newCopierCount: number },
  ): ScoreBreakdown {
    const updatedMetrics: ProviderMetrics = {
      providerId: '',
      totalSignals: previous.totalSignals + delta.signalsDelta,
      winningSignals: previous.winningSignals + delta.winsDelta,
      totalCopiers: Math.max(previous.totalCopiers, delta.newCopierCount),
      activeCopiers: delta.newCopierCount,
      stakeAmount: previous.stakeAmount,
      avgRating: previous.avgRating,
      ratingCount: previous.ratingCount,
      activeDays: previous.activeDays,
      activeDaysLast30: previous.activeDaysLast30,
    };

    const breakdown = this.calculateScore(updatedMetrics);
    const smoothedScore = this.applyEMA(previous.smoothedScore, breakdown.score);

    return {
      ...breakdown,
      smoothedScore: parseFloat(smoothedScore.toFixed(2)),
    };
  }

  /**
   * Bulk update scores for all providers — used by the daily cron job.
   */
  async updateAllProviderScores(allMetrics: ProviderMetrics[]): Promise<void> {
    this.logger.log(`Updating reputation scores for ${allMetrics.length} providers`);

    const results = await Promise.allSettled(
      allMetrics.map((metrics) => this.updateProviderScore(metrics)),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.warn(`${failed} provider score updates failed`);
    }

    this.logger.log(
      `Reputation update complete: ${results.length - failed} succeeded, ${failed} failed`,
    );
  }

  /**
   * Full recompute for a single provider — used as a correctness safeguard
   * against incremental drift. Returns the freshly computed score.
   */
  async fullRecompute(metrics: ProviderMetrics): Promise<ReputationScore> {
    return this.updateProviderScore(metrics);
  }

  /**
   * Return the most recent score record for a provider.
   */
  async getLatestScore(providerId: string): Promise<ReputationScore | null> {
    return this.reputationScoreRepo.findOne({
      where: { providerId },
      order: { recordedAt: 'DESC' },
    });
  }

  /**
   * Return paginated historical score records for trending charts.
   */
  async getScoreHistory(
    providerId: string,
    limit = 30,
  ): Promise<ReputationScore[]> {
    return this.reputationScoreRepo.find({
      where: { providerId },
      order: { recordedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Return top N providers ordered by their latest smoothed score.
   * Uses a subquery to select only the most recent record per provider.
   */
  async getLeaderboard(limit = 20): Promise<ReputationScore[]> {
    return this.dataSource
      .createQueryBuilder()
      .select('rs.*')
      .from(
        (sub) =>
          sub
            .select('DISTINCT ON ("providerId") *')
            .from(ReputationScore, 'rs')
            .orderBy('"providerId"')
            .addOrderBy('"recordedAt"', 'DESC'),
        'rs',
      )
      .orderBy('"smoothedScore"', 'DESC')
      .limit(limit)
      .getRawMany();
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private calculateWinRate(metrics: ProviderMetrics): number {
    if (metrics.totalSignals === 0) return 0;
    return metrics.winningSignals / metrics.totalSignals;
  }

  /**
   * Consistency: ratio of active days in the last 30 days.
   * Capped at 1 (full score = at least one signal every day).
   */
  private calculateConsistency(metrics: ProviderMetrics): number {
    return Math.min(1, metrics.activeDaysLast30 / 30);
  }

  /**
   * Copier retention: ratio of active copiers to total who ever copied.
   */
  private calculateRetentionRate(metrics: ProviderMetrics): number {
    if (metrics.totalCopiers === 0) return 0;
    return Math.min(1, metrics.activeCopiers / metrics.totalCopiers);
  }

  /**
   * Stake bonus: logarithmic to prevent whale dominance.
   * Full bonus (1.0) at MAX_STAKE_FOR_FULL_BONUS.
   */
  private calculateStakeBonus(stakeAmount: number): number {
    if (stakeAmount <= 0) return 0;
    return Math.min(
      1,
      Math.log10(1 + stakeAmount) / Math.log10(1 + MAX_STAKE_FOR_FULL_BONUS),
    );
  }

  /**
   * Normalize a 1-5 rating to 0-1.
   * If fewer than 3 ratings exist, blend toward 0.5 (neutral) to reduce noise.
   */
  private normalizeRating(avgRating: number, ratingCount: number): number {
    if (ratingCount === 0) return 0.5; // neutral default
    const normalized = (avgRating - 1) / 4; // map [1,5] → [0,1]
    if (ratingCount < 3) {
      // Blend toward 0.5 when sample is small
      const weight = ratingCount / 3;
      return normalized * weight + 0.5 * (1 - weight);
    }
    return normalized;
  }

  /**
   * Exponential Moving Average smoothing to reduce score volatility.
   */
  private applyEMA(previousSmoothed: number, currentScore: number): number {
    return EMA_ALPHA * currentScore + (1 - EMA_ALPHA) * Number(previousSmoothed);
  }

  /**
   * Confidence factor for new providers: grows from 0 → 1 as they accumulate signals.
   */
  private getConfidenceFactor(metrics: ProviderMetrics): number {
    const signalConfidence = Math.min(
      1,
      metrics.totalSignals / MIN_SIGNALS_FOR_FULL_SCORE,
    );
    const dayConfidence = Math.min(1, metrics.activeDays / NEW_PROVIDER_DAYS);
    return (signalConfidence + dayConfidence) / 2;
  }
}
