import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import Big from 'big.js';
import {
  ProviderRevenuePayout,
  ProviderTierAssignment,
  RevenueShareTier,
  ProviderTierLevel,
  BonusType,
  PayoutStatus,
} from './entities/revenue-share-tier.entity';
import { TierManagerService } from './tier-manager.service';
import { ProviderStats } from '../../signals/entities/provider-stats.entity';
import { User } from '../../users/entities/user.entity';

// ─────────────────────────────────────────────────────────────────────────────
// Stellar payment gateway
// ─────────────────────────────────────────────────────────────────────────────

export interface RevenueSharePaymentRequest {
  destinationAddress: string;
  amount: string;
  asset: string;
  memo?: string;
  /**
   * Stable key for the payment. Gateways that support it must treat a repeat
   * of the same key as the same payment so a retry cannot pay twice.
   */
  idempotencyKey?: string;
}

export interface RevenueSharePaymentReceipt {
  transactionHash: string;
}

/**
 * Thin port over the existing Stellar payment integration (StellarModule /
 * StellarService). Only the pieces the revenue-share path needs are exposed so
 * the accounting logic stays testable and decoupled from the SDK.
 */
export interface RevenueSharePaymentGateway {
  sendPayment(params: RevenueSharePaymentRequest): Promise<RevenueSharePaymentReceipt>;
  /**
   * Optional lookup used to reconcile a submission that timed out after the
   * network accepted it — resolves to the original payment if one exists.
   */
  findPaymentByMemo?(memo: string): Promise<RevenueSharePaymentReceipt | null>;
}

export const REVENUE_SHARE_PAYMENT_GATEWAY = 'REVENUE_SHARE_PAYMENT_GATEWAY';

// ─────────────────────────────────────────────────────────────────────────────
// DTOs (inline – keep the module self-contained)
// ─────────────────────────────────────────────────────────────────────────────

export interface RevenueShareCalculationDto {
  providerId: string;
  tierLevel: ProviderTierLevel;
  sharePercentage: string;
  baseRevenue: string;
  revenueShareAmount: string;
  bonusAmount: string;
  bonusType?: BonusType;
  totalPayout: string;
}

export interface PayoutHistoryDto {
  data: ProviderRevenuePayout[];
  total: number;
  page: number;
  limit: number;
}

export interface ProviderEarningsSummaryDto {
  providerId: string;
  currentTier: ProviderTierLevel;
  revenueSharePercentage: string;
  totalEarnings: string;
  totalBonuses: string;
  pendingPayouts: string;
  lastPayoutAt?: Date;
  monthlyBreakdown: Array<{
    year: number;
    month: number;
    revenueShare: string;
    bonuses: string;
    total: string;
  }>;
}

export interface MonthlyBatchResult {
  processed: number;
  totalDispatched: string;
  successfulPayouts: number;
  failedPayouts: number;
  skipped: number;
  details: Array<{
    providerId: string;
    status: 'success' | 'failed' | 'skipped';
    amount: string;
    reason?: string;
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class RevenueShareService {
  private readonly logger = new Logger(RevenueShareService.name);

  /** In-flight on-chain dispatches keyed by payout id — prevents double payment under retries. */
  private readonly inFlightPayments = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(ProviderRevenuePayout)
    private readonly payoutRepo: Repository<ProviderRevenuePayout>,

    @InjectRepository(ProviderTierAssignment)
    private readonly assignmentRepo: Repository<ProviderTierAssignment>,

    @InjectRepository(RevenueShareTier)
    private readonly tierRepo: Repository<RevenueShareTier>,

    @InjectRepository(ProviderStats)
    private readonly statsRepo: Repository<ProviderStats>,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly tierManager: TierManagerService,

    @Optional()
    @Inject(REVENUE_SHARE_PAYMENT_GATEWAY)
    private readonly paymentGateway?: RevenueSharePaymentGateway,
  ) {}

  // ─── Revenue Share Calculation ─────────────────────────────────────────────

  /**
   * Calculate the revenue share owed to a provider for a given base revenue
   * amount (e.g., subscription fees or copy-trade commissions attributed to them).
   *
   * @param providerId  UUID of the signal provider
   * @param baseRevenue Amount (USDC) the platform earned from this provider's subscribers/copiers
   * @param includeBonus Whether to add the monthly retention bonus on top
   */
  async calculateRevenueShare(
    providerId: string,
    baseRevenue: string,
    includeBonus = false,
  ): Promise<RevenueShareCalculationDto> {
    if (new Big(baseRevenue).lte(0)) {
      throw new BadRequestException('Base revenue must be positive');
    }

    // Get or create provider's tier assignment
    let assignment = await this.assignmentRepo.findOne({
      where: { providerId },
    });

    if (!assignment) {
      // First time – run a tier evaluation
      await this.tierManager.evaluateProvider(providerId);
      assignment = await this.assignmentRepo.findOne({ where: { providerId } });
    }

    const tierLevel = assignment?.currentTier ?? ProviderTierLevel.BRONZE;

    const tierDef = await this.tierRepo.findOne({ where: { tierLevel } });
    if (!tierDef) {
      throw new NotFoundException(`Tier definition for ${tierLevel} not found`);
    }

    const sharePercentage = tierDef.revenueSharePercentage;
    const revenueShareAmount = new Big(baseRevenue)
      .times(new Big(sharePercentage))
      .div(100)
      .toFixed(8);

    let bonusAmount = '0.00000000';
    let bonusType: BonusType | undefined;

    if (includeBonus && parseFloat(tierDef.monthlyRetentionBonusUsdc) > 0) {
      bonusAmount = new Big(tierDef.monthlyRetentionBonusUsdc).toFixed(8);
      bonusType = BonusType.MONTHLY_TOP;
    }

    const totalPayout = new Big(revenueShareAmount)
      .plus(new Big(bonusAmount))
      .toFixed(8);

    return {
      providerId,
      tierLevel,
      sharePercentage,
      baseRevenue,
      revenueShareAmount,
      bonusAmount,
      bonusType,
      totalPayout,
    };
  }

  // ─── Single Payout Dispatch ────────────────────────────────────────────────

  /**
   * Calculate, record, and (if wallet available) dispatch a revenue-share
   * payout to a single provider.
   */
  async processProviderPayout(
    providerId: string,
    baseRevenue: string,
    options: {
      includeBonus?: boolean;
      periodYear?: number;
      periodMonth?: number;
      bonusOverride?: { amount: string; type: BonusType };
    } = {},
  ): Promise<ProviderRevenuePayout> {
    const { includeBonus = true, periodYear, periodMonth, bonusOverride } = options;

    const calc = await this.calculateRevenueShare(providerId, baseRevenue, includeBonus);

    // Resolve provider wallet
    const user = await this.userRepo.findOne({ where: { id: providerId } });
    if (!user) {
      throw new NotFoundException(`Provider user ${providerId} not found`);
    }

    const bonusAmount = bonusOverride?.amount ?? calc.bonusAmount;
    const bonusType = bonusOverride?.type ?? calc.bonusType;
    const totalPayout = new Big(calc.revenueShareAmount)
      .plus(new Big(bonusAmount))
      .toFixed(8);

    const payout = await this.tierManager.recordPayout({
      providerId,
      tierLevel: calc.tierLevel,
      baseRevenue,
      sharePercentage: calc.sharePercentage,
      revenueShareAmount: calc.revenueShareAmount,
      bonusAmount,
      bonusType,
      totalPayout,
      providerWalletAddress: user.walletAddress,
      periodYear,
      periodMonth,
    });

    // Escalate payout for Elite/Platinum providers (automatic approval)
    if (
      calc.tierLevel === ProviderTierLevel.ELITE ||
      calc.tierLevel === ProviderTierLevel.PLATINUM
    ) {
      await this.escalatePayout(payout);
    }

    this.logger.log(
      `Payout created for provider ${providerId} | tier: ${calc.tierLevel} | ` +
        `amount: ${totalPayout} USDC | payout id: ${payout.id}`,
    );

    return payout;
  }

  /**
   * Mark a payout as processing and dispatch it on-chain.
   *
   * The DB row is the accounting record of origin: the Stellar transaction
   * hash is written back onto it, so payment status and hash stay queryable
   * through the existing history/reporting endpoints.
   */
  private async escalatePayout(payout: ProviderRevenuePayout): Promise<void> {
    payout.status = PayoutStatus.PROCESSING;
    await this.payoutRepo.save(payout);

    this.logger.log(
      `Payout ${payout.id} auto-escalated to PROCESSING for ${payout.tierLevel} provider`,
    );

    await this.dispatchPayoutOnChain(payout);
  }

  /**
   * Submit an approved payout through the Stellar integration.
   *
   * Guarantees at most one Stellar payment per accounting record:
   *  - a completed payout (or one that already has a hash) is never re-sent;
   *  - concurrent submissions for the same payout share one in-flight promise;
   *  - when the gateway exposes `findPaymentByMemo`, a retry after a timeout
   *    reuses the payment that actually landed instead of paying twice.
   */
  async dispatchPayoutOnChain(payout: ProviderRevenuePayout): Promise<void> {
    if (!this.paymentGateway) {
      this.logger.warn(
        `No Stellar payment gateway configured — payout ${payout.id} left PROCESSING for manual dispatch.`,
      );
      return;
    }

    if (payout.status === PayoutStatus.COMPLETED || payout.stellarTxHash) {
      this.logger.debug(`Payout ${payout.id} already paid on Stellar — skipping dispatch.`);
      return;
    }

    const inFlight = this.inFlightPayments.get(payout.id);
    if (inFlight) {
      return inFlight;
    }

    const submission = this.submitPayout(payout).finally(() =>
      this.inFlightPayments.delete(payout.id),
    );
    this.inFlightPayments.set(payout.id, submission);
    return submission;
  }

  private async submitPayout(payout: ProviderRevenuePayout): Promise<void> {
    const memo = `revenue-share:${payout.id}`;

    try {
      let receipt: RevenueSharePaymentReceipt | null = null;

      // Reconcile an earlier attempt that may have landed before we lost the
      // response (e.g. a timeout) so the retry does not create a second payment.
      if (this.paymentGateway!.findPaymentByMemo) {
        receipt = await this.paymentGateway!.findPaymentByMemo(memo);
        if (receipt) {
          this.logger.warn(
            `Payout ${payout.id} already submitted on Stellar (tx=${receipt.transactionHash}); reusing transaction.`,
          );
        }
      }

      if (!receipt) {
        receipt = await this.paymentGateway!.sendPayment({
          destinationAddress: payout.providerWalletAddress,
          amount: payout.totalPayout,
          asset: payout.assetCode || 'USDC',
          memo,
          idempotencyKey: payout.id,
        });
      }

      await this.payoutRepo.update(payout.id, {
        status: PayoutStatus.COMPLETED,
        stellarTxHash: receipt.transactionHash,
        failureReason: null,
        paidAt: new Date(),
      });
      payout.status = PayoutStatus.COMPLETED;
      payout.stellarTxHash = receipt.transactionHash;
      payout.paidAt = new Date();

      this.logger.log(
        `Payout ${payout.id} COMPLETED on Stellar (tx=${receipt.transactionHash}, ${payout.totalPayout} ${payout.assetCode})`,
      );
    } catch (error: any) {
      const reason: string = error?.message ?? 'Unknown Stellar error';
      await this.payoutRepo.update(payout.id, {
        status: PayoutStatus.FAILED,
        failureReason: reason,
        retryCount: (payout.retryCount ?? 0) + 1,
      });
      payout.status = PayoutStatus.FAILED;
      payout.failureReason = reason;
      payout.retryCount = (payout.retryCount ?? 0) + 1;

      this.logger.error(
        `Payout ${payout.id} FAILED on Stellar: ${reason}`,
        error?.stack,
      );
    }
  }

  /**
   * Dispatch every payout still awaiting settlement (e.g. after a partial
   * failure or a gateway outage). Safe to run on a schedule: completed and
   * already-paid payouts are skipped.
   */
  async dispatchPendingPayouts(limit = 50): Promise<{
    attempted: number;
    completed: number;
    failed: number;
  }> {
    const pending = await this.getPendingPayouts(limit);
    let completed = 0;
    let failed = 0;

    for (const payout of pending) {
      await this.dispatchPayoutOnChain(payout);
      if (payout.status === PayoutStatus.COMPLETED) {
        completed++;
      } else if (payout.status === PayoutStatus.FAILED) {
        failed++;
      }
    }

    this.logger.log(
      `Pending payout dispatch: ${completed} completed, ${failed} failed of ${pending.length} attempted`,
    );

    return { attempted: pending.length, completed, failed };
  }

  /**
   * Fetch a single payout (accounting record) so callers can query its status
   * and Stellar transaction hash after dispatch.
   */
  async getPayoutById(payoutId: string): Promise<ProviderRevenuePayout> {
    const payout = await this.payoutRepo.findOne({ where: { id: payoutId } });
    if (!payout) {
      throw new NotFoundException(`Payout ${payoutId} not found`);
    }
    return payout;
  }

  // ─── Monthly Batch Payouts ─────────────────────────────────────────────────

  /**
   * Process monthly revenue-share payouts for ALL active providers.
   * Designed to be called via a scheduled job.
   *
   * @param year         Billing year
   * @param month        Billing month (1-12)
   * @param revenueMap   Map of providerId → base revenue earned this month
   */
  async processMontlyBatch(
    year: number,
    month: number,
    revenueMap: Map<string, string>,
  ): Promise<MonthlyBatchResult> {
    const result: MonthlyBatchResult = {
      processed: 0,
      totalDispatched: '0',
      successfulPayouts: 0,
      failedPayouts: 0,
      skipped: 0,
      details: [],
    };

    let totalDispatched = new Big(0);

    for (const [providerId, baseRevenue] of revenueMap.entries()) {
      result.processed++;

      if (new Big(baseRevenue).lte(0)) {
        result.skipped++;
        result.details.push({
          providerId,
          status: 'skipped',
          amount: '0',
          reason: 'Zero revenue',
        });
        continue;
      }

      try {
        const payout = await this.processProviderPayout(providerId, baseRevenue, {
          includeBonus: true,
          periodYear: year,
          periodMonth: month,
        });

        totalDispatched = totalDispatched.plus(new Big(payout.totalPayout));
        result.successfulPayouts++;
        result.details.push({
          providerId,
          status: 'success',
          amount: payout.totalPayout,
        });
      } catch (err: any) {
        result.failedPayouts++;
        result.details.push({
          providerId,
          status: 'failed',
          amount: '0',
          reason: err.message,
        });
        this.logger.error(
          `Monthly payout failed for provider ${providerId}: ${err.message}`,
        );
      }
    }

    result.totalDispatched = totalDispatched.toFixed(8);

    this.logger.log(
      `Monthly batch ${year}-${month}: ${result.successfulPayouts} succeeded, ` +
        `${result.failedPayouts} failed, ${result.skipped} skipped. ` +
        `Total dispatched: ${result.totalDispatched} USDC`,
    );

    return result;
  }

  // ─── Performance Bonuses ───────────────────────────────────────────────────

  /**
   * Award a one-off performance bonus to a provider (e.g., win-streak reward,
   * leaderboard milestone).
   */
  async awardPerformanceBonus(
    providerId: string,
    bonusAmountUsdc: string,
    bonusType: BonusType,
    reason?: string,
  ): Promise<ProviderRevenuePayout> {
    const user = await this.userRepo.findOne({ where: { id: providerId } });
    if (!user) {
      throw new NotFoundException(`Provider ${providerId} not found`);
    }

    const assignment = await this.assignmentRepo.findOne({
      where: { providerId },
    });
    const tierLevel = assignment?.currentTier ?? ProviderTierLevel.BRONZE;

    const payout = await this.tierManager.recordPayout({
      providerId,
      tierLevel,
      baseRevenue: '0',
      sharePercentage: '0',
      revenueShareAmount: '0',
      bonusAmount: bonusAmountUsdc,
      bonusType,
      totalPayout: bonusAmountUsdc,
      providerWalletAddress: user.walletAddress,
    });

    this.logger.log(
      `Performance bonus of ${bonusAmountUsdc} USDC awarded to ${providerId} ` +
        `(type: ${bonusType}${reason ? `, reason: ${reason}` : ''})`,
    );

    return payout;
  }

  // ─── Payout History & Reporting ────────────────────────────────────────────

  async getProviderPayoutHistory(
    providerId: string,
    page = 1,
    limit = 20,
  ): Promise<PayoutHistoryDto> {
    const [data, total] = await this.payoutRepo.findAndCount({
      where: { providerId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async getProviderEarningsSummary(
    providerId: string,
  ): Promise<ProviderEarningsSummaryDto> {
    const assignment = await this.assignmentRepo.findOne({
      where: { providerId },
    });
    if (!assignment) {
      throw new NotFoundException(
        `No tier assignment found for provider ${providerId}`,
      );
    }

    const tierDef = await this.tierRepo.findOne({
      where: { tierLevel: assignment.currentTier },
    });

    const allPayouts = await this.payoutRepo.find({ where: { providerId } });

    let totalEarnings = new Big(0);
    let totalBonuses = new Big(0);
    let pendingPayouts = new Big(0);
    let lastPayoutAt: Date | undefined;

    const monthlyMap = new Map<
      string,
      { year: number; month: number; revenueShare: Big; bonuses: Big }
    >();

    for (const p of allPayouts) {
      const rs = new Big(p.revenueShareAmount);
      const bonus = new Big(p.bonusAmount);

      if (p.status === PayoutStatus.COMPLETED) {
        totalEarnings = totalEarnings.plus(rs).plus(bonus);
        totalBonuses = totalBonuses.plus(bonus);
        if (!lastPayoutAt || (p.paidAt && p.paidAt > lastPayoutAt)) {
          lastPayoutAt = p.paidAt;
        }
      } else if (
        p.status === PayoutStatus.PENDING ||
        p.status === PayoutStatus.PROCESSING
      ) {
        pendingPayouts = pendingPayouts.plus(new Big(p.totalPayout));
      }

      const key = `${p.periodYear}-${p.periodMonth}`;
      if (!monthlyMap.has(key)) {
        monthlyMap.set(key, {
          year: p.periodYear,
          month: p.periodMonth,
          revenueShare: new Big(0),
          bonuses: new Big(0),
        });
      }
      const entry = monthlyMap.get(key)!;
      entry.revenueShare = entry.revenueShare.plus(rs);
      entry.bonuses = entry.bonuses.plus(bonus);
    }

    const monthlyBreakdown = Array.from(monthlyMap.values())
      .sort((a, b) => b.year - a.year || b.month - a.month)
      .map((m) => ({
        year: m.year,
        month: m.month,
        revenueShare: m.revenueShare.toFixed(8),
        bonuses: m.bonuses.toFixed(8),
        total: m.revenueShare.plus(m.bonuses).toFixed(8),
      }));

    return {
      providerId,
      currentTier: assignment.currentTier,
      revenueSharePercentage: tierDef?.revenueSharePercentage ?? '0',
      totalEarnings: totalEarnings.toFixed(8),
      totalBonuses: totalBonuses.toFixed(8),
      pendingPayouts: pendingPayouts.toFixed(8),
      lastPayoutAt,
      monthlyBreakdown,
    };
  }

  /**
   * Get all payouts for a billing period (useful for admin reporting).
   */
  async getPeriodPayouts(
    year: number,
    month: number,
  ): Promise<{
    payouts: ProviderRevenuePayout[];
    totalDispatched: string;
    tierBreakdown: Record<string, { count: number; total: string }>;
  }> {
    const payouts = await this.payoutRepo.find({
      where: { periodYear: year, periodMonth: month },
      order: { createdAt: 'DESC' },
    });

    let totalDispatched = new Big(0);
    const tierBreakdown: Record<string, { count: number; total: Big }> = {};

    for (const p of payouts) {
      if (p.status === PayoutStatus.COMPLETED || p.status === PayoutStatus.PROCESSING) {
        totalDispatched = totalDispatched.plus(new Big(p.totalPayout));
      }

      const key = p.tierLevel;
      if (!tierBreakdown[key]) {
        tierBreakdown[key] = { count: 0, total: new Big(0) };
      }
      tierBreakdown[key].count++;
      tierBreakdown[key].total = tierBreakdown[key].total.plus(new Big(p.totalPayout));
    }

    const tierBreakdownFormatted: Record<string, { count: number; total: string }> = {};
    for (const [tier, data] of Object.entries(tierBreakdown)) {
      tierBreakdownFormatted[tier] = {
        count: data.count,
        total: data.total.toFixed(8),
      };
    }

    return {
      payouts,
      totalDispatched: totalDispatched.toFixed(8),
      tierBreakdown: tierBreakdownFormatted,
    };
  }

  // ─── Payout Confirmation ────────────────────────────────────────────────────

  /**
   * Mark a payout as completed after on-chain Stellar confirmation.
   */
  async confirmPayout(
    payoutId: string,
    stellarTxHash: string,
  ): Promise<ProviderRevenuePayout> {
    const payout = await this.payoutRepo.findOne({ where: { id: payoutId } });
    if (!payout) {
      throw new NotFoundException(`Payout ${payoutId} not found`);
    }

    if (payout.status === PayoutStatus.COMPLETED) {
      this.logger.warn(`Payout ${payoutId} already completed`);
      return payout;
    }

    payout.status = PayoutStatus.COMPLETED;
    payout.stellarTxHash = stellarTxHash;
    payout.paidAt = new Date();

    return this.payoutRepo.save(payout);
  }

  /**
   * Mark a payout as failed (e.g., Stellar transaction rejected).
   */
  async markPayoutFailed(
    payoutId: string,
    reason: string,
  ): Promise<ProviderRevenuePayout> {
    const payout = await this.payoutRepo.findOne({ where: { id: payoutId } });
    if (!payout) {
      throw new NotFoundException(`Payout ${payoutId} not found`);
    }

    payout.status = PayoutStatus.FAILED;
    payout.failureReason = reason;
    payout.retryCount += 1;

    return this.payoutRepo.save(payout);
  }

  // ─── Incentive Program Management ──────────────────────────────────────────

  /**
   * Run the monthly Elite/Platinum retention bonus round (called by the
   * scheduler after a monthly batch evaluation).
   */
  async runRetentionBonusRound(
    year: number,
    month: number,
  ): Promise<{ credited: number; totalBonusUsdc: string }> {
    const topTiers = [ProviderTierLevel.ELITE, ProviderTierLevel.PLATINUM];
    let credited = 0;
    let totalBonus = new Big(0);

    for (const tier of topTiers) {
      const assignments = await this.assignmentRepo.find({
        where: { currentTier: tier },
      });
      const tierDef = await this.tierRepo.findOne({ where: { tierLevel: tier } });
      if (!tierDef || parseFloat(tierDef.monthlyRetentionBonusUsdc) === 0) {
        continue;
      }

      for (const assignment of assignments) {
        try {
          const user = await this.userRepo.findOne({
            where: { id: assignment.providerId },
          });
          if (!user) continue;

          await this.tierManager.recordPayout({
            providerId: assignment.providerId,
            tierLevel: tier,
            baseRevenue: '0',
            sharePercentage: '0',
            revenueShareAmount: '0',
            bonusAmount: tierDef.monthlyRetentionBonusUsdc,
            bonusType: BonusType.MONTHLY_TOP,
            totalPayout: tierDef.monthlyRetentionBonusUsdc,
            providerWalletAddress: user.walletAddress,
            periodYear: year,
            periodMonth: month,
          });

          totalBonus = totalBonus.plus(new Big(tierDef.monthlyRetentionBonusUsdc));
          credited++;
        } catch (err: any) {
          this.logger.error(
            `Retention bonus failed for ${assignment.providerId}: ${err.message}`,
          );
        }
      }
    }

    this.logger.log(
      `Retention bonus round ${year}-${month}: credited ${credited} providers, ` +
        `total: ${totalBonus.toFixed(8)} USDC`,
    );

    return { credited, totalBonusUsdc: totalBonus.toFixed(8) };
  }

  /**
   * Retrieve pending payouts that need to be dispatched on-chain.
   */
  async getPendingPayouts(limit = 50): Promise<ProviderRevenuePayout[]> {
    return this.payoutRepo.find({
      where: { status: PayoutStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Retry a specific failed payout (resets status to PENDING).
   */
  async retryFailedPayout(payoutId: string): Promise<ProviderRevenuePayout> {
    const payout = await this.payoutRepo.findOne({ where: { id: payoutId } });
    if (!payout) {
      throw new NotFoundException(`Payout ${payoutId} not found`);
    }

    if (payout.status !== PayoutStatus.FAILED) {
      throw new BadRequestException(
        `Only FAILED payouts can be retried (current status: ${payout.status})`,
      );
    }

    if (payout.retryCount >= 5) {
      throw new BadRequestException(
        `Payout ${payoutId} has exceeded maximum retry attempts (5)`,
      );
    }

    payout.status = PayoutStatus.PENDING;
    payout.failureReason = undefined;

    return this.payoutRepo.save(payout);
  }

  // ─── Provider Incentive Program ────────────────────────────────────────────

  /**
   * Evaluate whether a provider has reached a win-streak milestone and, if so,
   * issue the appropriate streak bonus.
   *
   * Win-streak thresholds → bonus amounts (USDC):
   *   5 wins  → 25
   *   10 wins → 75
   *   20 wins → 200
   */
  async checkAndIssueStreakBonus(providerId: string): Promise<{
    bonusIssued: boolean;
    bonusAmount: string;
    streakCount: number;
  }> {
    const stats = await this.statsRepo.findOne({ where: { providerId } });
    if (!stats) {
      return { bonusIssued: false, bonusAmount: '0', streakCount: 0 };
    }

    const streak = stats.streakWins;
    const thresholds: Array<{ threshold: number; bonus: string }> = [
      { threshold: 20, bonus: '200' },
      { threshold: 10, bonus: '75' },
      { threshold: 5, bonus: '25' },
    ];

    const match = thresholds.find((t) => streak >= t.threshold && streak % t.threshold === 0);

    if (!match) {
      return { bonusIssued: false, bonusAmount: '0', streakCount: streak };
    }

    // Avoid duplicate streak bonuses within the same month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const existingBonus = await this.payoutRepo.findOne({
      where: {
        providerId,
        bonusType: BonusType.STREAK,
        createdAt: Between(startOfMonth, now),
      },
    });

    if (existingBonus) {
      return { bonusIssued: false, bonusAmount: '0', streakCount: streak };
    }

    await this.awardPerformanceBonus(
      providerId,
      match.bonus,
      BonusType.STREAK,
      `Win streak of ${streak}`,
    );

    return { bonusIssued: true, bonusAmount: match.bonus, streakCount: streak };
  }
}
