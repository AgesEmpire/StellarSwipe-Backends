import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RevenueShareTier,
  ProviderTierAssignment,
  ProviderRevenuePayout,
  ProviderTierLevel,
  BonusType,
  PayoutStatus,
} from './entities/revenue-share-tier.entity';
import { ProviderStats } from '../../signals/entities/provider-stats.entity';
import { updateWithVersionCheck } from '../../common/utils/optimistic-update.util';

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface ProviderMetrics {
  providerId: string;
  winRate: number;
  totalSignals: number;
  totalCopiers: number;
  reputationScore: number;
  walletAddress: string;
}

export interface TierEvaluationResult {
  providerId: string;
  previousTier: ProviderTierLevel | null;
  newTier: ProviderTierLevel;
  promoted: boolean;
  demoted: boolean;
  bonusTriggered: boolean;
  bonusAmount: string;
}

export interface TierSummary {
  tierLevel: ProviderTierLevel;
  name: string;
  revenueSharePercentage: string;
  minWinRate: string;
  minSignals: number;
  minCopiers: number;
  performanceBonusUsdc: string;
  monthlyRetentionBonusUsdc: string;
  providerCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default tier configuration seeded on module init (idempotent)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TIERS: Omit<RevenueShareTier, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    tierLevel: ProviderTierLevel.BRONZE,
    name: 'Bronze Provider',
    description: 'Entry-level tier for new signal providers.',
    revenueSharePercentage: '4.00',
    minWinRate: '0',
    minSignals: 0,
    minCopiers: 0,
    minReputationScore: '0',
    performanceBonusUsdc: '0',
    monthlyRetentionBonusUsdc: '0',
    isActive: true,
    sortOrder: 1,
  },
  {
    tierLevel: ProviderTierLevel.SILVER,
    name: 'Silver Provider',
    description: 'Established providers with a consistent track record.',
    revenueSharePercentage: '6.00',
    minWinRate: '55',
    minSignals: 20,
    minCopiers: 10,
    minReputationScore: '55',
    performanceBonusUsdc: '10',
    monthlyRetentionBonusUsdc: '5',
    isActive: true,
    sortOrder: 2,
  },
  {
    tierLevel: ProviderTierLevel.GOLD,
    name: 'Gold Provider',
    description: 'High-performing providers with strong copier engagement.',
    revenueSharePercentage: '8.00',
    minWinRate: '62',
    minSignals: 50,
    minCopiers: 50,
    minReputationScore: '65',
    performanceBonusUsdc: '50',
    monthlyRetentionBonusUsdc: '20',
    isActive: true,
    sortOrder: 3,
  },
  {
    tierLevel: ProviderTierLevel.PLATINUM,
    name: 'Platinum Provider',
    description: 'Elite-class providers with outstanding performance.',
    revenueSharePercentage: '9.00',
    minWinRate: '68',
    minSignals: 100,
    minCopiers: 150,
    minReputationScore: '75',
    performanceBonusUsdc: '150',
    monthlyRetentionBonusUsdc: '50',
    isActive: true,
    sortOrder: 4,
  },
  {
    tierLevel: ProviderTierLevel.ELITE,
    name: 'Elite Provider',
    description: 'Top-tier providers who receive the maximum 10 % revenue share.',
    revenueSharePercentage: '10.00',
    minWinRate: '75',
    minSignals: 200,
    minCopiers: 300,
    minReputationScore: '85',
    performanceBonusUsdc: '500',
    monthlyRetentionBonusUsdc: '100',
    isActive: true,
    sortOrder: 5,
  },
];

// Tier precedence used for promotion/demotion comparison
const TIER_ORDER: ProviderTierLevel[] = [
  ProviderTierLevel.BRONZE,
  ProviderTierLevel.SILVER,
  ProviderTierLevel.GOLD,
  ProviderTierLevel.PLATINUM,
  ProviderTierLevel.ELITE,
];

@Injectable()
export class TierManagerService implements OnModuleInit {
  private readonly logger = new Logger(TierManagerService.name);

  // In-memory cache of tier definitions (refreshed on demand)
  private tierCache: RevenueShareTier[] = [];

  constructor(
    @InjectRepository(RevenueShareTier)
    private readonly tierRepo: Repository<RevenueShareTier>,

    @InjectRepository(ProviderTierAssignment)
    private readonly assignmentRepo: Repository<ProviderTierAssignment>,

    @InjectRepository(ProviderRevenuePayout)
    private readonly payoutRepo: Repository<ProviderRevenuePayout>,

    @InjectRepository(ProviderStats)
    private readonly statsRepo: Repository<ProviderStats>,
  ) {}

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.seedDefaultTiers();
    await this.refreshTierCache();
    this.logger.log('TierManagerService initialised – tiers seeded & cached.');
  }

  // ─── Seeding ───────────────────────────────────────────────────────────────

  /**
   * Idempotent seed: creates each tier once; never overwrites existing rows.
   */
  private async seedDefaultTiers(): Promise<void> {
    for (const tier of DEFAULT_TIERS) {
      const exists = await this.tierRepo.findOne({
        where: { tierLevel: tier.tierLevel },
      });
      if (!exists) {
        await this.tierRepo.save(this.tierRepo.create(tier));
        this.logger.log(`Seeded tier: ${tier.tierLevel}`);
      }
    }
  }

  // ─── Cache ─────────────────────────────────────────────────────────────────

  async refreshTierCache(): Promise<void> {
    this.tierCache = await this.tierRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
  }

  private getCachedTiers(): RevenueShareTier[] {
    return this.tierCache;
  }

  // ─── Tier Resolution ────────────────────────────────────────────────────────

  /**
   * Determine the highest tier a provider qualifies for based on their current
   * metrics snapshot. Iterates tiers from highest to lowest.
   */
  resolveTierForMetrics(metrics: ProviderMetrics): ProviderTierLevel {
    const tiers = [...this.getCachedTiers()].sort(
      (a, b) =>
        TIER_ORDER.indexOf(b.tierLevel) - TIER_ORDER.indexOf(a.tierLevel),
    );

    for (const tier of tiers) {
      const qualifies =
        metrics.winRate >= parseFloat(tier.minWinRate) &&
        metrics.totalSignals >= tier.minSignals &&
        metrics.totalCopiers >= tier.minCopiers &&
        metrics.reputationScore >= parseFloat(tier.minReputationScore);

      if (qualifies) {
        return tier.tierLevel;
      }
    }

    return ProviderTierLevel.BRONZE;
  }

  // ─── Evaluation ────────────────────────────────────────────────────────────

  /**
   * Evaluate a single provider and update their tier assignment.
   */
  async evaluateProvider(providerId: string): Promise<TierEvaluationResult> {
    const stats = await this.statsRepo.findOne({ where: { providerId } });

    const metrics: ProviderMetrics = {
      providerId,
      winRate: stats ? parseFloat(stats.winRate) : 0,
      totalSignals: stats?.totalSignals ?? 0,
      totalCopiers: stats?.totalCopiers ?? 0,
      reputationScore: stats ? parseFloat(stats.reputationScore) : 0,
      walletAddress: '', // populated by caller if needed
    };

    return this.evaluateProviderWithMetrics(metrics);
  }

  /**
   * Evaluate a provider given an already-resolved metrics object (useful when
   * the caller has already loaded stats and the wallet address).
   */
  async evaluateProviderWithMetrics(
    metrics: ProviderMetrics,
  ): Promise<TierEvaluationResult> {
    const newTier = this.resolveTierForMetrics(metrics);

    // Load or create the assignment record
    let assignment = await this.assignmentRepo.findOne({
      where: { providerId: metrics.providerId },
    });

    const previousTier = assignment?.currentTier ?? null;
    const wasPromoted =
      previousTier !== null &&
      TIER_ORDER.indexOf(newTier) > TIER_ORDER.indexOf(previousTier);
    const wasDemoted =
      previousTier !== null &&
      TIER_ORDER.indexOf(newTier) < TIER_ORDER.indexOf(previousTier);

    if (!assignment) {
      assignment = this.assignmentRepo.create({
        providerId: metrics.providerId,
        currentTier: newTier,
        promotionBonusPaid: false,
      });
    } else {
      assignment.previousTier = assignment.currentTier;
      assignment.currentTier = newTier;
    }

    // Update snapshot
    assignment.winRateSnapshot = String(metrics.winRate);
    assignment.signalsSnapshot = metrics.totalSignals;
    assignment.copiersSnapshot = metrics.totalCopiers;
    assignment.reputationSnapshot = String(metrics.reputationScore);
    assignment.lastEvaluatedAt = new Date();

    let bonusTriggered = false;
    let bonusAmount = '0';

    // Issue promotion bonus when provider moves up and hasn't been paid yet
    if (wasPromoted && metrics.walletAddress) {
      const tierDef = this.getCachedTiers().find((t) => t.tierLevel === newTier);
      if (tierDef && parseFloat(tierDef.performanceBonusUsdc) > 0) {
        bonusAmount = tierDef.performanceBonusUsdc;
        bonusTriggered = true;
        assignment.promotionBonusPaid = true;

        await this.recordPayout({
          providerId: metrics.providerId,
          tierLevel: newTier,
          baseRevenue: '0',
          sharePercentage: '0',
          revenueShareAmount: '0',
          bonusAmount,
          bonusType: BonusType.PERFORMANCE,
          totalPayout: bonusAmount,
          providerWalletAddress: metrics.walletAddress,
        });
      }
    }

    await this.assignmentRepo.save(assignment);

    this.logger.log(
      `Provider ${metrics.providerId}: ${previousTier ?? 'NEW'} → ${newTier}` +
        (wasPromoted ? ' ⬆ PROMOTED' : wasDemoted ? ' ⬇ DEMOTED' : ' ─ UNCHANGED') +
        (bonusTriggered ? ` (bonus: ${bonusAmount} USDC)` : ''),
    );

    return {
      providerId: metrics.providerId,
      previousTier,
      newTier,
      promoted: wasPromoted,
      demoted: wasDemoted,
      bonusTriggered,
      bonusAmount,
    };
  }

  /**
   * Batch-evaluate all providers who have a stats record.
   */
  async evaluateAllProviders(): Promise<TierEvaluationResult[]> {
    const allStats = await this.statsRepo.find();
    const results: TierEvaluationResult[] = [];

    for (const stats of allStats) {
      try {
        const result = await this.evaluateProvider(stats.providerId);
        results.push(result);
      } catch (err: any) {
        this.logger.error(
          `Failed to evaluate provider ${stats.providerId}: ${err.message}`,
        );
      }
    }

    this.logger.log(
      `Batch evaluation complete: ${results.length} providers processed.`,
    );

    return results;
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  async getProviderTier(providerId: string): Promise<ProviderTierAssignment | null> {
    return this.assignmentRepo.findOne({ where: { providerId } });
  }

  async getProvidersInTier(tierLevel: ProviderTierLevel): Promise<ProviderTierAssignment[]> {
    return this.assignmentRepo.find({ where: { currentTier: tierLevel } });
  }

  async getTierSummaries(): Promise<TierSummary[]> {
    const tiers = await this.tierRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });

    const summaries: TierSummary[] = [];

    for (const tier of tiers) {
      const count = await this.assignmentRepo.count({
        where: { currentTier: tier.tierLevel },
      });

      summaries.push({
        tierLevel: tier.tierLevel,
        name: tier.name,
        revenueSharePercentage: tier.revenueSharePercentage,
        minWinRate: tier.minWinRate,
        minSignals: tier.minSignals,
        minCopiers: tier.minCopiers,
        performanceBonusUsdc: tier.performanceBonusUsdc,
        monthlyRetentionBonusUsdc: tier.monthlyRetentionBonusUsdc,
        providerCount: count,
      });
    }

    return summaries;
  }

  // ─── Tier Config ───────────────────────────────────────────────────────────

  async getAllTierConfigs(): Promise<RevenueShareTier[]> {
    return this.tierRepo.find({ order: { sortOrder: 'ASC' } });
  }

  async getTierConfig(tierLevel: ProviderTierLevel): Promise<RevenueShareTier | null> {
    return this.tierRepo.findOne({ where: { tierLevel } });
  }

  /**
   * Updates a tier's threshold/bonus parameters using an atomic
   * compare-and-swap on `version`, so two admins editing the same tier
   * concurrently can't have one silently overwrite the other's change.
   */
  async updateTierConfig(
    tierLevel: ProviderTierLevel,
    updates: Partial<Pick<RevenueShareTier, 'revenueSharePercentage' | 'minWinRate' | 'minSignals' | 'minCopiers' | 'performanceBonusUsdc' | 'monthlyRetentionBonusUsdc' | 'isActive'>>,
    expectedVersion?: number,
  ): Promise<RevenueShareTier> {
    const tier = await this.tierRepo.findOne({ where: { tierLevel } });
    if (!tier) {
      throw new NotFoundException(`Tier ${tierLevel} not found`);
    }

    await updateWithVersionCheck(
      this.tierRepo,
      'RevenueShareTier',
      tier.id,
      expectedVersion ?? tier.version,
      updates,
    );

    // Invalidate cache
    await this.refreshTierCache();

    return this.tierRepo.findOneOrFail({ where: { tierLevel } });
  }

  // ─── Payout Recording ──────────────────────────────────────────────────────

  /**
   * Persist a new payout record.  The actual Stellar transfer is handled by
   * RevenueShareService; this method only creates the DB ledger entry.
   */
  async recordPayout(params: {
    providerId: string;
    tierLevel: ProviderTierLevel;
    baseRevenue: string;
    sharePercentage: string;
    revenueShareAmount: string;
    bonusAmount: string;
    bonusType?: BonusType;
    totalPayout: string;
    providerWalletAddress: string;
    periodYear?: number;
    periodMonth?: number;
  }): Promise<ProviderRevenuePayout> {
    const now = new Date();
    const payout = this.payoutRepo.create({
      providerId: params.providerId,
      tierLevel: params.tierLevel,
      baseRevenue: params.baseRevenue,
      sharePercentage: params.sharePercentage,
      revenueShareAmount: params.revenueShareAmount,
      bonusAmount: params.bonusAmount,
      bonusType: params.bonusType,
      totalPayout: params.totalPayout,
      assetCode: 'USDC',
      providerWalletAddress: params.providerWalletAddress,
      status: PayoutStatus.PENDING,
      periodYear: params.periodYear ?? now.getFullYear(),
      periodMonth: params.periodMonth ?? now.getMonth() + 1,
    });

    return this.payoutRepo.save(payout);
  }
}
