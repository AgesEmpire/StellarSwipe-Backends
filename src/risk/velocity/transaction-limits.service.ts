import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionLimit, UserTier, LimitType } from './entities/transaction-limit.entity';

interface LimitConfig {
  [UserTier.BASIC]: Record<LimitType, string>;
  [UserTier.VERIFIED]: Record<LimitType, string>;
  [UserTier.PREMIUM]: Record<LimitType, string>;
}

@Injectable()
export class TransactionLimitsService {
  private readonly logger = new Logger(TransactionLimitsService.name);

  private readonly defaultLimits: LimitConfig = {
    [UserTier.BASIC]: {
      [LimitType.DAILY_VOLUME]: '1000',
      [LimitType.WEEKLY_VOLUME]: '5000',
      [LimitType.HOURLY_TRADES]: '10',
      [LimitType.DAILY_TRADES]: '50',
    },
    [UserTier.VERIFIED]: {
      [LimitType.DAILY_VOLUME]: '10000',
      [LimitType.WEEKLY_VOLUME]: '50000',
      [LimitType.HOURLY_TRADES]: '25',
      [LimitType.DAILY_TRADES]: '200',
    },
    [UserTier.PREMIUM]: {
      [LimitType.DAILY_VOLUME]: '100000',
      [LimitType.WEEKLY_VOLUME]: '500000',
      [LimitType.HOURLY_TRADES]: '100',
      [LimitType.DAILY_TRADES]: '1000',
    },
  };

  constructor(
    @InjectRepository(TransactionLimit)
    private readonly limitRepository: Repository<TransactionLimit>,
  ) {}

  async initializeUserLimits(userId: string, userTier: UserTier = UserTier.BASIC): Promise<void> {
    const limits = this.defaultLimits[userTier];
    
    for (const [limitType, limitValue] of Object.entries(limits)) {
      await this.limitRepository.upsert(
        {
          userId,
          userTier,
          limitType: limitType as LimitType,
          limitValue,
          currentUsage: '0',
          lastResetAt: new Date(),
        },
        ['userId', 'limitType']
      );
    }
  }

  async checkLimit(userId: string, limitType: LimitType, amount: string): Promise<{
    allowed: boolean;
    remaining: string;
    resetAt?: Date;
  }> {
    const limit = await this.getUserLimit(userId, limitType);
    
    if (!limit) {
      await this.initializeUserLimits(userId);
      return this.checkLimit(userId, limitType, amount);
    }

    // Reset if needed
    await this.resetLimitIfNeeded(limit, limitType);

    const currentUsage = parseFloat(limit.currentUsage);
    const requestAmount = parseFloat(amount);
    const limitValue = parseFloat(limit.limitValue);
    const remaining = Math.max(0, limitValue - currentUsage);

    return {
      allowed: requestAmount <= remaining,
      remaining: remaining.toFixed(8),
      resetAt: this.getNextResetTime(limitType),
    };
  }

  async consumeLimit(userId: string, limitType: LimitType, amount: string): Promise<void> {
    const limit = await this.getUserLimit(userId, limitType);
    if (!limit) return;

    await this.limitRepository.update(
      { userId, limitType },
      {
        currentUsage: (parseFloat(limit.currentUsage) + parseFloat(amount)).toFixed(8),
      }
    );
  }

  async setCoolingOff(userId: string, durationMinutes: number): Promise<void> {
    const coolingOffUntil = new Date(Date.now() + durationMinutes * 60 * 1000);
    
    await this.limitRepository.update(
      { userId },
      { coolingOffUntil }
    );

    this.logger.warn(`User ${userId} in cooling-off period until ${coolingOffUntil}`);
  }

  async isInCoolingOff(userId: string): Promise<boolean> {
    const limit = await this.limitRepository.findOne({
      where: { userId },
      order: { coolingOffUntil: 'DESC' },
    });

    return limit?.coolingOffUntil ? new Date() < limit.coolingOffUntil : false;
  }

  async upgradeUserTier(userId: string, newTier: UserTier): Promise<void> {
    await this.limitRepository.update(
      { userId },
      { userTier: newTier }
    );

    // Update limit values
    await this.initializeUserLimits(userId, newTier);
    this.logger.log(`User ${userId} upgraded to ${newTier} tier`);
  }

  private async getUserLimit(userId: string, limitType: LimitType): Promise<TransactionLimit | null> {
    return this.limitRepository.findOne({
      where: { userId, limitType },
    });
  }

  private async resetLimitIfNeeded(limit: TransactionLimit, limitType: LimitType): Promise<void> {
    const now = new Date();
    const shouldReset = this.shouldResetLimit(limit.lastResetAt, limitType, now);

    if (shouldReset) {
      await this.limitRepository.update(
        { id: limit.id },
        {
          currentUsage: '0',
          lastResetAt: now,
        }
      );
    }
  }

  private shouldResetLimit(lastReset: Date, limitType: LimitType, now: Date): boolean {
    const timeDiff = now.getTime() - lastReset.getTime();
    
    switch (limitType) {
      case LimitType.HOURLY_TRADES:
        return timeDiff >= 60 * 60 * 1000; // 1 hour
      case LimitType.DAILY_VOLUME:
      case LimitType.DAILY_TRADES:
        return timeDiff >= 24 * 60 * 60 * 1000; // 24 hours
      case LimitType.WEEKLY_VOLUME:
        return timeDiff >= 7 * 24 * 60 * 60 * 1000; // 7 days
      default:
        return false;
    }
  }

  private getNextResetTime(limitType: LimitType): Date {
    const now = new Date();
    
    switch (limitType) {
      case LimitType.HOURLY_TRADES:
        return new Date(now.getTime() + 60 * 60 * 1000);
      case LimitType.DAILY_VOLUME:
      case LimitType.DAILY_TRADES:
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        return tomorrow;
      case LimitType.WEEKLY_VOLUME:
        const nextWeek = new Date(now);
        nextWeek.setDate(nextWeek.getDate() + (7 - nextWeek.getDay()));
        nextWeek.setHours(0, 0, 0, 0);
        return nextWeek;
      default:
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }
  }
}