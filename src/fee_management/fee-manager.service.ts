import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { FeeTier, FeeTierType } from './entities/fee-tier.entity';
import {
  FeePromotion,
  FeePromotionRedemption,
  PromotionStatus,
  PromotionType,
} from './entities/fee-promotion.entity';

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface FeeTierConfig {
  tierType: FeeTierType;
  name: string;
  feeRate: string;
  minVolume: string;
  maxVolume?: string;
  minTrades: number;
  requiresVip: boolean;
}

export interface PromotionInfo {
  id: string;
  promoCode: string;
  name: string;
  promotionType: PromotionType;
  discountPercentage?: string;
  fixedFeeRate?: string;
  maxDiscount?: string;
  applicableAssets?: string[];
}

export interface UserPromotionEligibility {
  eligible: boolean;
  reason?: string;
  promotion?: PromotionInfo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default fee tiers (seeded on module init)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_FEE_TIERS: Omit<FeeTier, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    tierType: FeeTierType.STANDARD,
    name: 'Standard',
    description: 'Standard trading fee for all users',
    feeRate: '0.001',
    minVolume: '0',
    maxVolume: '9999.99',
    minTrades: 0,
    requiresVip: false,
    isActive: true,
    isDefault: true,
    sortOrder: 1,
  },
  {
    tierType: FeeTierType.HIGH_VOLUME,
    name: 'High Volume',
    description: 'Reduced fee for high-volume traders',
    feeRate: '0.0008',
    minVolume: '10000',
    maxVolume: '49999.99',
    minTrades: 50,
    requiresVip: false,
    isActive: true,
    isDefault: false,
    sortOrder: 2,
  },
  {
    tierType: FeeTierType.VIP,
    name: 'VIP',
    description: 'Premium tier for VIP members',
    feeRate: '0.0005',
    minVolume: '0',
    minTrades: 0,
    requiresVip: true,
    isActive: true,
    isDefault: false,
    sortOrder: 3,
  },
];

@Injectable()
export class FeeManagerService implements OnModuleInit {
  private readonly logger = new Logger(FeeManagerService.name);

  constructor(
    @InjectRepository(FeeTier)
    private readonly feeTierRepo: Repository<FeeTier>,

    @InjectRepository(FeePromotion)
    private readonly promotionRepo: Repository<FeePromotion>,

    @InjectRepository(FeePromotionRedemption)
    private readonly redemptionRepo: Repository<FeePromotionRedemption>,
  ) {}

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.seedDefaultTiers();
    this.logger.log('FeeManagerService initialized – fee tiers seeded.');
  }

  // ─── Seeding ───────────────────────────────────────────────────────────────

  /**
   * Idempotent seed: creates each tier once; never overwrites existing rows.
   */
  private async seedDefaultTiers(): Promise<void> {
    for (const tier of DEFAULT_FEE_TIERS) {
      const exists = await this.feeTierRepo.findOne({
        where: { tierType: tier.tierType },
      });
      if (!exists) {
        await this.feeTierRepo.save(this.feeTierRepo.create(tier));
        this.logger.log(`Seeded fee tier: ${tier.tierType}`);
      }
    }
  }

  // ─── Fee Tier CRUD ─────────────────────────────────────────────────────────

  /**
   * Get all fee tiers
   */
  async getAllFeeTiers(): Promise<FeeTier[]> {
    return this.feeTierRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC' },
    });
  }

  /**
   * Get a specific fee tier by type
   */
  async getFeeTier(tierType: FeeTierType): Promise<FeeTier> {
    const tier = await this.feeTierRepo.findOne({ where: { tierType } });
    if (!tier) {
      throw new NotFoundException(`Fee tier ${tierType} not found`);
    }
    return tier;
  }

  /**
   * Get the default fee tier
   */
  async getDefaultFeeTier(): Promise<FeeTier> {
    const tier = await this.feeTierRepo.findOne({ where: { isDefault: true } });
    if (!tier) {
      // Fallback to STANDARD
      return this.getFeeTier(FeeTierType.STANDARD);
    }
    return tier;
  }

  /**
   * Determine the appropriate fee tier for a user based on their metrics
   */
  async determineUserFeeTier(params: {
    userId: string;
    monthlyVolume: string;
    tradeCount: number;
    isVip: boolean;
  }): Promise<FeeTier> {
    const { monthlyVolume, tradeCount, isVip } = params;

    // Get all active tiers ordered by sort order (highest first)
    const tiers = await this.feeTierRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'DESC' },
    });

    for (const tier of tiers) {
      // Check volume requirements
      const minVol = parseFloat(tier.minVolume);
      const maxVol = tier.maxVolume ? parseFloat(tier.maxVolume) : Infinity;

      const userVol = parseFloat(monthlyVolume);
      const meetsVolume = userVol >= minVol && userVol < maxVol;

      // Check trade count
      const meetsTrades = tradeCount >= tier.minTrades;

      // Check VIP requirement
      const meetsVip = !tier.requiresVip || isVip;

      if (meetsVolume && meetsTrades && meetsVip) {
        return tier;
      }
    }

    // Fallback to default tier
    return this.getDefaultFeeTier();
  }

  /**
   * Update a fee tier configuration
   */
  async updateFeeTier(
    tierType: FeeTierType,
    updates: Partial<
      Pick<
        FeeTier,
        | 'feeRate'
        | 'minVolume'
        | 'maxVolume'
        | 'minTrades'
        | 'requiresVip'
        | 'isActive'
        | 'isDefault'
      >
    >,
  ): Promise<FeeTier> {
    const tier = await this.feeTierRepo.findOne({ where: { tierType } });
    if (!tier) {
      throw new NotFoundException(`Fee tier ${tierType} not found`);
    }

    // If setting as default, unset other defaults
    if (updates.isDefault) {
      await this.feeTierRepo.update({ isDefault: true }, { isDefault: false });
    }

    Object.assign(tier, updates);
    return this.feeTierRepo.save(tier);
  }

  /**
   * Create a new custom fee tier
   */
  async createFeeTier(
    data: Omit<FeeTier, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<FeeTier> {
    // Check if tier type already exists
    const exists = await this.feeTierRepo.findOne({
      where: { tierType: data.tierType },
    });
    if (exists) {
      throw new BadRequestException(`Fee tier ${data.tierType} already exists`);
    }

    // If setting as default, unset other defaults
    if (data.isDefault) {
      await this.feeTierRepo.update({ isDefault: true }, { isDefault: false });
    }

    const tier = this.feeTierRepo.create(data);
    return this.feeTierRepo.save(tier);
  }

  // ─── Promotion CRUD ────────────────────────────────────────────────────────

  /**
   * Get all promotions
   */
  async getAllPromotions(status?: PromotionStatus): Promise<FeePromotion[]> {
    const where: any = {};
    if (status) {
      where.status = status;
    }
    return this.promotionRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get active promotions that are currently valid
   */
  async getActivePromotions(): Promise<FeePromotion[]> {
    const now = new Date();
    return this.promotionRepo
      .createQueryBuilder('promotion')
      .where('promotion.status = :status', { status: PromotionStatus.ACTIVE })
      .andWhere('promotion.startDate <= :now', { now })
      .andWhere('promotion.endDate >= :now', { now })
      .andWhere(
        '(promotion.maxUses IS NULL OR promotion.currentUses < promotion.maxUses)',
      )
      .orderBy('promotion.createdAt', 'DESC')
      .getMany();
  }

  /**
   * Get a promotion by ID
   */
  async getPromotion(id: string): Promise<FeePromotion> {
    const promotion = await this.promotionRepo.findOne({ where: { id } });
    if (!promotion) {
      throw new NotFoundException(`Promotion ${id} not found`);
    }
    return promotion;
  }

  /**
   * Get a promotion by promo code
   */
  async getPromotionByCode(promoCode: string): Promise<FeePromotion> {
    const promotion = await this.promotionRepo.findOne({
      where: { promoCode: promoCode.toUpperCase() },
    });
    if (!promotion) {
      throw new NotFoundException(`Promotion with code ${promoCode} not found`);
    }
    return promotion;
  }

  /**
   * Create a new promotion
   */
  async createPromotion(
    data: Omit<FeePromotion, 'id' | 'createdAt' | 'updatedAt' | 'currentUses'>,
  ): Promise<FeePromotion> {
    // Validate promo code uniqueness
    const exists = await this.promotionRepo.findOne({
      where: { promoCode: data.promoCode?.toUpperCase() },
    });
    if (exists) {
      throw new BadRequestException(
        `Promotion code ${data.promoCode} already exists`,
      );
    }

    // Set initial status based on dates
    const now = new Date();
    if (data.startDate > now) {
      data.status = PromotionStatus.SCHEDULED;
    } else if (data.endDate < now) {
      data.status = PromotionStatus.EXPIRED;
    } else {
      data.status = PromotionStatus.ACTIVE;
    }

    const promotion = this.promotionRepo.create(data);
    return this.promotionRepo.save(promotion);
  }

  /**
   * Update a promotion
   */
  async updatePromotion(
    id: string,
    updates: Partial<Omit<FeePromotion, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<FeePromotion> {
    const promotion = await this.getPromotion(id);
    Object.assign(promotion, updates);
    return this.promotionRepo.save(promotion);
  }

  /**
   * Cancel a promotion
   */
  async cancelPromotion(id: string): Promise<FeePromotion> {
    const promotion = await this.getPromotion(id);
    promotion.status = PromotionStatus.CANCELLED;
    return this.promotionRepo.save(promotion);
  }

  /**
   * Check promotion eligibility for a user
   */
  async checkPromotionEligibility(
    promoCode: string,
    userId: string,
    tradeAmount: string,
    assetCode: string,
  ): Promise<UserPromotionEligibility> {
    try {
      const promotion = await this.getPromotionByCode(promoCode);

      // Check status
      if (promotion.status === PromotionStatus.CANCELLED) {
        return { eligible: false, reason: 'Promotion has been cancelled' };
      }
      if (promotion.status === PromotionStatus.EXPIRED) {
        return { eligible: false, reason: 'Promotion has expired' };
      }

      // Check date validity
      const now = new Date();
      if (now < promotion.startDate) {
        return { eligible: false, reason: 'Promotion has not started yet' };
      }
      if (now > promotion.endDate) {
        return { eligible: false, reason: 'Promotion has ended' };
      }

      // Check max uses
      if (promotion.maxUses && promotion.currentUses >= promotion.maxUses) {
        return { eligible: false, reason: 'Promotion usage limit reached' };
      }

      // Check user-specific eligibility
      if (
        promotion.eligibleUserIds &&
        !promotion.eligibleUserIds.includes(userId)
      ) {
        return {
          eligible: false,
          reason: 'User not eligible for this promotion',
        };
      }

      // Check minimum trade amount
      if (promotion.minTradeAmount) {
        const minAmount = parseFloat(promotion.minTradeAmount);
        const tradeAmt = parseFloat(tradeAmount);
        if (tradeAmt < minAmount) {
          return {
            eligible: false,
            reason: `Minimum trade amount of ${minAmount} required`,
          };
        }
      }

      // Check asset applicability
      if (promotion.applicableAssets) {
        const assets = promotion.applicableAssets
          .split(',')
          .map((a) => a.trim());
        if (!assets.includes(assetCode) && !assets.includes('*')) {
          return {
            eligible: false,
            reason: 'Promotion not applicable to this asset',
          };
        }
      }

      // Check per-user usage limit
      if (promotion.maxUsesPerUser) {
        const userRedemptions = await this.redemptionRepo.count({
          where: {
            promotionId: promotion.id,
            userId,
          },
        });
        if (userRedemptions >= promotion.maxUsesPerUser) {
          return {
            eligible: false,
            reason: 'User has reached maximum uses for this promotion',
          };
        }
      }

      return {
        eligible: true,
        promotion: {
          id: promotion.id,
          promoCode: promotion.promoCode,
          name: promotion.name,
          promotionType: promotion.promotionType,
          discountPercentage: promotion.discountPercentage,
          fixedFeeRate: promotion.fixedFeeRate,
          maxDiscount: promotion.maxDiscount,
          applicableAssets: promotion.applicableAssets
            ?.split(',')
            .map((a) => a.trim()),
        },
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        return { eligible: false, reason: 'Invalid promotion code' };
      }
      throw error;
    }
  }

  /**
   * Redeem a promotion (record usage)
   */
  async redeemPromotion(params: {
    promotionId: string;
    userId: string;
    tradeId?: string;
    originalFee: string;
    discountedFee: string;
  }): Promise<FeePromotionRedemption> {
    const promotion = await this.getPromotion(params.promotionId);

    // Increment usage counter
    promotion.currentUses += 1;
    await this.promotionRepo.save(promotion);

    // Record redemption
    const redemption = this.redemptionRepo.create({
      ...params,
      savings: (
        parseFloat(params.originalFee) - parseFloat(params.discountedFee)
      ).toFixed(8),
    });

    return this.redemptionRepo.save(redemption);
  }

  /**
   * Get promotion redemption history for a user
   */
  async getUserRedemptions(userId: string): Promise<FeePromotionRedemption[]> {
    return this.redemptionRepo.find({
      where: { userId },
      order: { redeemedAt: 'DESC' },
    });
  }

  /**
   * Get promotion statistics
   */
  async getPromotionStats(promotionId: string): Promise<{
    totalRedemptions: number;
    totalSavings: string;
    uniqueUsers: number;
  }> {
    const redemptions = await this.redemptionRepo.find({
      where: { promotionId },
    });

    let totalSavings = 0;
    const uniqueUsers = new Set<string>();

    for (const r of redemptions) {
      totalSavings += parseFloat(r.savings);
      uniqueUsers.add(r.userId);
    }

    return {
      totalRedemptions: redemptions.length,
      totalSavings: totalSavings.toFixed(8),
      uniqueUsers: uniqueUsers.size,
    };
  }

  // ─── Scheduling ───────────────────────────────────────────────────────────

  /**
   * Update promotion statuses based on current date
   * Called by scheduled job
   */
  async updatePromotionStatuses(): Promise<{
    activated: number;
    expired: number;
  }> {
    const now = new Date();

    // Activate scheduled promotions that have started
    const toActivate = await this.promotionRepo
      .createQueryBuilder('promotion')
      .where('promotion.status = :status', {
        status: PromotionStatus.SCHEDULED,
      })
      .andWhere('promotion.startDate <= :now', { now })
      .getMany();

    for (const p of toActivate) {
      p.status = PromotionStatus.ACTIVE;
      await this.promotionRepo.save(p);
    }

    // Expire active promotions that have ended
    const toExpire = await this.promotionRepo
      .createQueryBuilder('promotion')
      .where('promotion.status = :status', { status: PromotionStatus.ACTIVE })
      .andWhere('promotion.endDate < :now', { now })
      .getMany();

    for (const p of toExpire) {
      p.status = PromotionStatus.EXPIRED;
      await this.promotionRepo.save(p);
    }

    this.logger.log(
      `Promotion status update: ${toActivate.length} activated, ${toExpire.length} expired`,
    );

    return {
      activated: toActivate.length,
      expired: toExpire.length,
    };
  }
}
