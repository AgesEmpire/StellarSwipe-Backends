import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import {
  TransactionLimit,
  LimitType,
  LimitScope,
} from './entities/transaction-limit.entity';
import { TransactionUsage } from './entities/transaction-usage.entity';
import Big from 'big.js';

export interface LimitCheckResult {
  allowed: boolean;
  limit: string;
  used: string;
  remaining: string;
  currency: string;
  limitType: LimitType;
  message?: string;
}

@Injectable()
export class TransactionLimitsService {
  private readonly logger = new Logger(TransactionLimitsService.name);

  constructor(
    @InjectRepository(TransactionLimit)
    private readonly limitRepository: Repository<TransactionLimit>,
    @InjectRepository(TransactionUsage)
    private readonly usageRepository: Repository<TransactionUsage>,
  ) {}

  async checkLimit(
    userId: string,
    amount: string,
    currency: string,
    limitScope: LimitScope,
    userTier: string = 'basic',
    region?: string,
  ): Promise<LimitCheckResult> {
    // Get applicable limits
    const limits = await this.getApplicableLimits(
      userTier,
      region,
      limitScope,
      currency,
    );

    if (limits.length === 0) {
      this.logger.warn(
        `No limits configured for ${limitScope} - ${userTier} - ${region}`,
      );
      return {
        allowed: true,
        limit: '0',
        used: '0',
        remaining: '0',
        currency,
        limitType: LimitType.DAILY,
      };
    }

    // Check each limit type
    for (const limit of limits) {
      const result = await this.checkSingleLimit(
        userId,
        amount,
        currency,
        limit,
      );
      if (!result.allowed) {
        return result;
      }
    }

    return {
      allowed: true,
      limit: limits[0].limitAmount,
      used: '0',
      remaining: limits[0].limitAmount,
      currency,
      limitType: limits[0].limitType,
    };
  }

  private async checkSingleLimit(
    userId: string,
    amount: string,
    currency: string,
    limit: TransactionLimit,
  ): Promise<LimitCheckResult> {
    const { periodStart, periodEnd } = this.getPeriodDates(limit.limitType);

    // Get current usage
    const usage = await this.usageRepository.findOne({
      where: {
        userId,
        limitType: limit.limitType,
        limitScope: limit.limitScope,
        periodStart: LessThanOrEqual(periodEnd),
        periodEnd: MoreThanOrEqual(periodStart),
      },
    });

    const usedAmount = usage ? new Big(usage.usedAmount) : new Big(0);
    const requestAmount = new Big(amount);
    const limitAmount = new Big(limit.limitAmount);
    const newTotal = usedAmount.plus(requestAmount);

    const allowed = newTotal.lte(limitAmount);
    const remaining = allowed
      ? limitAmount.minus(newTotal).toString()
      : '0';

    return {
      allowed,
      limit: limit.limitAmount,
      used: usedAmount.toString(),
      remaining,
      currency: limit.currency,
      limitType: limit.limitType,
      message: allowed
        ? undefined
        : `${limit.limitType} ${limit.limitScope} limit of ${limit.limitAmount} ${limit.currency} exceeded`,
    };
  }

  async recordUsage(
    userId: string,
    amount: string,
    currency: string,
    limitScope: LimitScope,
    limitType: LimitType,
  ): Promise<void> {
    const { periodStart, periodEnd } = this.getPeriodDates(limitType);

    let usage = await this.usageRepository.findOne({
      where: {
        userId,
        limitType,
        limitScope,
        periodStart: LessThanOrEqual(periodEnd),
        periodEnd: MoreThanOrEqual(periodStart),
      },
    });

    if (usage) {
      usage.usedAmount = new Big(usage.usedAmount).plus(amount).toString();
      await this.usageRepository.save(usage);
    } else {
      usage = this.usageRepository.create({
        userId,
        limitType,
        limitScope,
        usedAmount: amount,
        currency,
        periodStart,
        periodEnd,
      });
      await this.usageRepository.save(usage);
    }

    this.logger.log(
      `Recorded ${amount} ${currency} usage for user ${userId} - ${limitScope} ${limitType}`,
    );
  }

  private async getApplicableLimits(
    userTier: string,
    region: string | undefined,
    limitScope: LimitScope,
    currency: string,
  ): Promise<TransactionLimit[]> {
    // Priority: user tier + region > user tier > region > global
    const queries = [
      { userTier, region, limitScope, currency, isActive: true },
      { userTier, region: null, limitScope, currency, isActive: true },
      { userTier: null, region, limitScope, currency, isActive: true },
      { userTier: null, region: null, limitScope, currency, isActive: true },
    ];

    for (const query of queries) {
      const limits = await this.limitRepository.find({ where: query });
      if (limits.length > 0) {
        return limits;
      }
    }

    return [];
  }

  private getPeriodDates(limitType: LimitType): {
    periodStart: Date;
    periodEnd: Date;
  } {
    const now = new Date();
    let periodStart: Date;
    let periodEnd: Date;

    switch (limitType) {
      case LimitType.DAILY:
        periodStart = new Date(now.setHours(0, 0, 0, 0));
        periodEnd = new Date(now.setHours(23, 59, 59, 999));
        break;
      case LimitType.WEEKLY:
        const dayOfWeek = now.getDay();
        periodStart = new Date(now);
        periodStart.setDate(now.getDate() - dayOfWeek);
        periodStart.setHours(0, 0, 0, 0);
        periodEnd = new Date(periodStart);
        periodEnd.setDate(periodStart.getDate() + 6);
        periodEnd.setHours(23, 59, 59, 999);
        break;
      case LimitType.MONTHLY:
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
      case LimitType.PER_TRANSACTION:
        periodStart = now;
        periodEnd = now;
        break;
    }

    return { periodStart, periodEnd };
  }

  async createLimit(
    userTier: string | null,
    region: string | null,
    limitType: LimitType,
    limitScope: LimitScope,
    limitAmount: string,
    currency: string,
  ): Promise<TransactionLimit> {
    const limit = this.limitRepository.create({
      userTier,
      region,
      limitType,
      limitScope,
      limitAmount,
      currency,
      isActive: true,
    });

    return this.limitRepository.save(limit);
  }
}
