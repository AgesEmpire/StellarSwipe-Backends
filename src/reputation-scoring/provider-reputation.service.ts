import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReputationScore } from './reputation-score.entity';
import { ReputationScoringService, ProviderMetrics } from './reputation-scoring.service';

export type SignalOutcomeType = 'success' | 'failure' | 'invalidated';

export interface SignalOutcomeEvent {
  providerId: string;
  signalId: string;
  outcome: SignalOutcomeType;
  returnPct: number;
  copierCount: number;
}

export interface ReputationUpdateResult {
  providerId: string;
  previousScore: number;
  newScore: number;
  delta: number;
  isBlacklisted: boolean;
}

// Number of consecutive invalidated signals that triggers automatic blacklisting
const BLACKLIST_INVALIDATION_THRESHOLD = 5;

@Injectable()
export class ProviderReputationService {
  private readonly logger = new Logger(ProviderReputationService.name);

  constructor(
    @InjectRepository(ReputationScore)
    private readonly reputationRepo: Repository<ReputationScore>,
    private readonly scoringService: ReputationScoringService,
  ) {}

  /**
   * Applies a signal outcome event to the provider's reputation record.
   * Handles success, failure, and rollback (invalidated) cases.
   * Blacklists providers who accumulate too many invalidated signals.
   */
  async applySignalOutcome(event: SignalOutcomeEvent): Promise<ReputationUpdateResult> {
    const record = await this.reputationRepo.findOne({
      where: { providerId: event.providerId },
    });

    if (!record) {
      throw new NotFoundException(`Reputation record not found for provider: ${event.providerId}`);
    }

    const previousScore = Number(record.score);

    if ((record as any).isBlacklisted) {
      this.logger.warn(`Skipping outcome for blacklisted provider: ${event.providerId}`);
      return { providerId: event.providerId, previousScore, newScore: previousScore, delta: 0, isBlacklisted: true };
    }

    this.applyOutcomeToRecord(record, event);
    this.checkAndApplyBlacklist(record);

    const metrics = this.buildMetrics(record, event.copierCount);
    const breakdown = this.scoringService.calculateScore(metrics);

    record.score = breakdown.smoothedScore;
    record.winRate = breakdown.winRate;
    record.consistencyScore = breakdown.consistencyScore;
    record.retentionRate = breakdown.retentionRate;
    record.stakeBonus = breakdown.stakeBonus;

    await this.reputationRepo.save(record);

    const newScore = Number(record.score);
    this.logger.log(
      `Provider ${event.providerId} score: ${previousScore} → ${newScore} (${event.outcome})`,
    );

    return {
      providerId: event.providerId,
      previousScore,
      newScore,
      delta: parseFloat((newScore - previousScore).toFixed(2)),
      isBlacklisted: !!(record as any).isBlacklisted,
    };
  }

  /**
   * Returns the current reputation record for a provider.
   */
  async getReputation(providerId: string): Promise<ReputationScore> {
    const record = await this.reputationRepo.findOne({ where: { providerId } });
    if (!record) {
      throw new NotFoundException(`Reputation record not found: ${providerId}`);
    }
    return record;
  }

  /**
   * Initialises a blank reputation record for a newly onboarded provider.
   * Idempotent — returns the existing record if one is already present.
   */
  async initReputation(providerId: string, stakeAmount: number): Promise<ReputationScore> {
    const existing = await this.reputationRepo.findOne({ where: { providerId } });
    if (existing) return existing;

    const record = this.reputationRepo.create({
      providerId,
      stakeAmount,
      score: 50, // neutral starting score
      winRate: 0,
      consistencyScore: 0,
      retentionRate: 0,
      stakeBonus: 0,
      avgRating: 0,
      totalSignals: 0,
      winningSignals: 0,
      totalCopiers: 0,
      activeCopiers: 0,
    });

    return this.reputationRepo.save(record);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private applyOutcomeToRecord(record: ReputationScore, event: SignalOutcomeEvent): void {
    record.totalCopiers = Math.max(record.totalCopiers, event.copierCount);

    switch (event.outcome) {
      case 'success':
        record.totalSignals += 1;
        record.winningSignals += 1;
        break;
      case 'failure':
        record.totalSignals += 1;
        break;
      case 'invalidated':
        // Roll back: remove signal from totals
        record.totalSignals = Math.max(0, record.totalSignals - 1);
        (record as any).invalidatedCount = ((record as any).invalidatedCount ?? 0) + 1;
        break;
    }
  }

  private checkAndApplyBlacklist(record: ReputationScore): void {
    const invalidated = (record as any).invalidatedCount ?? 0;
    if (invalidated >= BLACKLIST_INVALIDATION_THRESHOLD) {
      (record as any).isBlacklisted = true;
      this.logger.warn(`Provider ${record.providerId} auto-blacklisted after ${invalidated} invalidations`);
    }
  }

  private buildMetrics(record: ReputationScore, copierCount: number): ProviderMetrics {
    return {
      providerId: record.providerId,
      totalSignals: record.totalSignals,
      winningSignals: record.winningSignals,
      totalCopiers: record.totalCopiers,
      activeCopiers: copierCount,
      stakeAmount: Number(record.stakeAmount),
      avgRating: Number(record.avgRating),
      ratingCount: 0,
      activeDays: 30,
      activeDaysLast30: 20,
    };
  }
}
