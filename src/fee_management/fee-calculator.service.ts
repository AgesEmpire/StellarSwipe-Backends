import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThanOrEqual, Between } from 'typeorm';
import Big from 'big.js';
import { FeeTier, FeeTierType } from './entities/fee-tier.entity';
import {
  FeeTransaction,
  FeeStatus,
  FeeTier as TransactionFeeTier,
} from './entities/fee-transaction.entity';
import { FeeManagerService } from './fee-manager.service';
import {
  FeePromotion,
  PromotionType,
  FeePromotionRedemption,
} from './entities/fee-promotion.entity';

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface TradeDetails {
  userId: string;
  tradeId?: string;
  tradeAmount: string;
  assetCode: string;
  assetIssuer?: string;
  userPublicKey?: string;
}

export interface FeeCalculationResult {
  tradeAmount: string;
  feeAmount: string;
  feeRate: string;
  feeTier: FeeTierType;
  netAmount: string;
  assetCode: string;
  promotionApplied?: {
    promoCode: string;
    originalFee: string;
    discountedFee: string;
    savings: string;
  };
}

export interface FeeCollectionResult {
  success: boolean;
  feeTransaction?: FeeTransaction;
  promotionRedemption?: FeePromotionRedemption;
  transactionHash?: string;
  error?: string;
}

export interface RevenueForecast {
  period: string;
  projectedVolume: string;
  projectedFees: string;
  projectedPromotions: string;
  netRevenue: string;
  assumptions: string[];
}

export interface TierVolumeStats {
  tierType: FeeTierType;
  userCount: number;
  totalVolume: string;
  totalFees: string;
  averageFeeRate: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class FeeCalculatorService {
  private readonly logger = new Logger(FeeCalculatorService.name);

  constructor(
    @InjectRepository(FeeTransaction)
    private readonly feeTransactionRepo: Repository<FeeTransaction>,

    @InjectRepository(FeePromotion)
    private readonly promotionRepo: Repository<FeePromotion>,

    private readonly feeManager: FeeManagerService,
  ) {}

  // ─── Fee Calculation ─────────────────────────────────────────────────────

  /**
   * Calculate fee for a trade with dynamic tier and promotion support
   */
  async calculateFee(
    tradeDetails: TradeDetails,
    options: {
      promoCode?: string;
      userMonthlyVolume?: string;
      userTradeCount?: number;
      isVip?: boolean;
    } = {},
  ): Promise<FeeCalculationResult> {
    const tradeAmount = new Big(tradeDetails.tradeAmount);

    if (tradeAmount.lte(0)) {
      throw new BadRequestException('Trade amount must be positive');
    }

    // Determine user's fee tier based on volume and activity
    const userTier = await this.feeManager.determineUserFeeTier({
      userId: tradeDetails.userId,
      monthlyVolume: options.userMonthlyVolume || '0',
      tradeCount: options.userTradeCount || 0,
      isVip: options.isVip || false,
    });

    // Get the fee rate for the tier
    const feeRate = userTier.feeRate;
    const feeTier = userTier.tierType;

    // Calculate base fee
    const feeAmount = tradeAmount.times(new Big(feeRate));
    const netAmount = tradeAmount.minus(feeAmount);

    // Round to 7 decimal places (Stellar standard)
    const roundedFeeAmount = feeAmount.toFixed(7);
    const roundedNetAmount = netAmount.toFixed(7);

    const result: FeeCalculationResult = {
      tradeAmount: tradeDetails.tradeAmount,
      feeAmount: roundedFeeAmount,
      feeRate,
      feeTier,
      netAmount: roundedNetAmount,
      assetCode: tradeDetails.assetCode,
    };

    // Check for promotional discount
    if (options.promoCode) {
      const eligibility = await this.feeManager.checkPromotionEligibility(
        options.promoCode,
        tradeDetails.userId,
        tradeDetails.tradeAmount,
        tradeDetails.assetCode,
      );

      if (eligibility.eligible && eligibility.promotion) {
        const promo = eligibility.promotion;
        let discountedFee = roundedFeeAmount;

        if (
          promo.promotionType === PromotionType.PERCENTAGE_DISCOUNT &&
          promo.discountPercentage
        ) {
          const discount = new Big(roundedFeeAmount)
            .times(new Big(promo.discountPercentage))
            .div(100);

          // Apply max discount cap if specified
          if (promo.maxDiscount) {
            const maxDiscount = new Big(promo.maxDiscount);
            if (discount.gt(maxDiscount)) {
              discountedFee = new Big(roundedFeeAmount)
                .minus(maxDiscount)
                .toFixed(7);
            } else {
              discountedFee = new Big(roundedFeeAmount)
                .minus(discount)
                .toFixed(7);
            }
          } else {
            discountedFee = new Big(roundedFeeAmount)
              .minus(discount)
              .toFixed(7);
          }
        } else if (
          promo.promotionType === PromotionType.FIXED_FEE &&
          promo.fixedFeeRate
        ) {
          discountedFee = promo.fixedFeeRate;
        } else if (promo.promotionType === PromotionType.FEE_WAIVER) {
          discountedFee = '0.0000000';
        }

        const savings = new Big(roundedFeeAmount)
          .minus(discountedFee)
          .toFixed(7);

        result.feeAmount = discountedFee;
        result.promotionApplied = {
          promoCode: options.promoCode,
          originalFee: roundedFeeAmount,
          discountedFee,
          savings,
        };
      }
    }

    return result;
  }

  /**
   * Calculate and collect fee on trade execution
   */
  async calculateAndCollectFee(
    tradeDetails: TradeDetails,
    options: {
      promoCode?: string;
      userMonthlyVolume?: string;
      userTradeCount?: number;
      isVip?: boolean;
    } = {},
  ): Promise<FeeCollectionResult> {
    let feeTransaction: FeeTransaction | undefined;
    let promotionRedemption: FeePromotionRedemption | undefined;

    try {
      // Calculate fee
      const feeCalculation = await this.calculateFee(tradeDetails, options);

      // Map FeeTierType to TransactionFeeTier
      const transactionFeeTier = this.mapFeeTierTypeToTransactionTier(
        feeCalculation.feeTier,
      );

      // Create fee transaction record
      feeTransaction = this.feeTransactionRepo.create({
        userId: tradeDetails.userId,
        tradeId: tradeDetails.tradeId,
        tradeAmount: tradeDetails.tradeAmount,
        feeAmount: feeCalculation.feeAmount,
        feeRate: feeCalculation.feeRate,
        feeTier: transactionFeeTier,
        assetCode: tradeDetails.assetCode,
        assetIssuer: tradeDetails.assetIssuer || '',
        status: FeeStatus.PENDING,
        metadata: {
          promotionCode: feeCalculation.promotionApplied?.promoCode,
          originalFeeRate: feeCalculation.promotionApplied?.originalFee,
          userTier: feeCalculation.feeTier,
          monthlyVolume: options.userMonthlyVolume,
        },
      }) as FeeTransaction;

      await this.feeTransactionRepo.save(feeTransaction);

      // Redeem promotion if applied
      if (feeCalculation.promotionApplied && tradeDetails.tradeId) {
        const promotion = await this.promotionRepo.findOne({
          where: {
            promoCode: feeCalculation.promotionApplied.promoCode.toUpperCase(),
          },
        });

        if (promotion) {
          promotionRedemption = await this.feeManager.redeemPromotion({
            promotionId: promotion.id,
            userId: tradeDetails.userId,
            tradeId: tradeDetails.tradeId,
            originalFee: feeCalculation.promotionApplied.originalFee,
            discountedFee: feeCalculation.promotionApplied.discountedFee,
          });
        }
      }

      return {
        success: true,
        feeTransaction,
        promotionRedemption,
      };
    } catch (error: any) {
      this.logger.error(`Fee collection failed: ${error.message}`, error.stack);

      if (feeTransaction) {
        feeTransaction.status = FeeStatus.FAILED;
        feeTransaction.failureReason = error.message;
        await this.feeTransactionRepo.save(feeTransaction);

        return {
          success: false,
          feeTransaction,
          error: error.message,
        };
      }

      return {
        success: false,
        error: error.message,
      };
    }
  }

  // ─── Revenue Forecasting ───────────────────────────────────────────────────

  /**
   * Generate revenue forecast based on historical data and current trends
   */
  async generateRevenueForecast(
    startDate: Date,
    endDate: Date,
    options: {
      includePromotions?: boolean;
      growthRate?: number;
    } = {},
  ): Promise<RevenueForecast> {
    const { includePromotions = true, growthRate = 0.05 } = options;

    // Get historical data
    const historicalFees = await this.feeTransactionRepo.find({
      where: {
        createdAt: Between(startDate, endDate),
        status: FeeStatus.COLLECTED,
      },
    });

    let totalVolume = new Big(0);
    let totalFees = new Big(0);
    let totalPromotionalSavings = new Big(0);

    for (const fee of historicalFees) {
      totalVolume = totalVolume.plus(new Big(fee.tradeAmount));
      totalFees = totalFees.plus(new Big(fee.feeAmount));

      if (fee.metadata?.promotionCode) {
        const originalFee = new Big(
          fee.metadata.originalFeeRate || fee.feeRate,
        );
        const actualFee = new Big(fee.feeAmount);
        totalPromotionalSavings = totalPromotionalSavings.plus(
          originalFee.minus(actualFee),
        );
      }
    }

    // Calculate daily averages
    const daysDiff = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    const dailyAvgVolume = totalVolume.div(daysDiff);
    const dailyAvgFees = totalFees.div(daysDiff);

    // Project forward (same period length)
    const projectionDays = daysDiff;
    let projectedVolume = dailyAvgVolume
      .times(projectionDays)
      .times(1 + growthRate);
    let projectedFees = dailyAvgFees
      .times(projectionDays)
      .times(1 + growthRate);

    // Get active promotions to estimate promotional impact
    let projectedPromotions = '0';
    if (includePromotions) {
      const activePromos = await this.feeManager.getActivePromotions();
      for (const promo of activePromos) {
        if (promo.discountPercentage) {
          const avgDiscount = parseFloat(promo.discountPercentage) / 100;
          // Estimate based on historical redemption rate
          const estimatedRedemptions = historicalFees.length * 0.1; // 10% redemption rate estimate
          projectedPromotions = new Big(projectedPromotions)
            .plus(projectedFees.times(avgDiscount).times(estimatedRedemptions))
            .toFixed(8);
        }
      }
    }

    const netRevenue = projectedFees.minus(new Big(projectedPromotions));

    return {
      period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
      projectedVolume: projectedVolume.toFixed(2),
      projectedFees: projectedFees.toFixed(2),
      projectedPromotions,
      netRevenue: netRevenue.toFixed(2),
      assumptions: [
        `Based on ${historicalFees.length} historical transactions`,
        `Growth rate: ${(growthRate * 100).toFixed(1)}%`,
        includePromotions
          ? 'Includes active promotions impact'
          : 'Excludes promotions',
      ],
    };
  }

  /**
   * Get volume statistics by tier
   */
  async getTierVolumeStats(
    startDate: Date,
    endDate: Date,
  ): Promise<TierVolumeStats[]> {
    const fees = await this.feeTransactionRepo.find({
      where: {
        createdAt: Between(startDate, endDate),
        status: FeeStatus.COLLECTED,
      },
    });

    const tierStats = new Map<
      FeeTierType,
      { userCount: Set<string>; totalVolume: Big; totalFees: Big }
    >();

    for (const fee of fees) {
      const tierType = this.mapTransactionTierToFeeTierType(fee.feeTier);
      const userId = fee.userId;

      if (!tierStats.has(tierType)) {
        tierStats.set(tierType, {
          userCount: new Set(),
          totalVolume: new Big(0),
          totalFees: new Big(0),
        });
      }

      const stats = tierStats.get(tierType)!;
      stats.userCount.add(userId);
      stats.totalVolume = stats.totalVolume.plus(new Big(fee.tradeAmount));
      stats.totalFees = stats.totalFees.plus(new Big(fee.feeAmount));
    }

    const result: TierVolumeStats[] = [];

    for (const [tierType, stats] of tierStats) {
      const avgFeeRate = stats.totalVolume.gt(0)
        ? stats.totalFees.div(stats.totalVolume).toFixed(6)
        : '0';

      result.push({
        tierType,
        userCount: stats.userCount.size,
        totalVolume: stats.totalVolume.toFixed(2),
        totalFees: stats.totalFees.toFixed(2),
        averageFeeRate: avgFeeRate,
      });
    }

    return result.sort((a, b) => b.totalVolume.localeCompare(a.totalVolume));
  }

  // ─── Helper Methods ────────────────────────────────────────────────────────

  /**
   * Map FeeTierType (from fee tiers table) to TransactionFeeTier (from fee transactions)
   */
  private mapFeeTierTypeToTransactionTier(
    tierType: FeeTierType,
  ): TransactionFeeTier {
    switch (tierType) {
      case FeeTierType.VIP:
        return TransactionFeeTier.VIP;
      case FeeTierType.HIGH_VOLUME:
        return TransactionFeeTier.HIGH_VOLUME;
      case FeeTierType.PROMOTIONAL:
        return TransactionFeeTier.PROMOTIONAL;
      case FeeTierType.STANDARD:
      default:
        return TransactionFeeTier.STANDARD;
    }
  }

  /**
   * Map TransactionFeeTier to FeeTierType
   */
  private mapTransactionTierToFeeTierType(
    tier: TransactionFeeTier,
  ): FeeTierType {
    switch (tier) {
      case TransactionFeeTier.VIP:
        return FeeTierType.VIP;
      case TransactionFeeTier.HIGH_VOLUME:
        return FeeTierType.HIGH_VOLUME;
      case TransactionFeeTier.PROMOTIONAL:
        return FeeTierType.PROMOTIONAL;
      case TransactionFeeTier.STANDARD:
      default:
        return FeeTierType.STANDARD;
    }
  }
}
