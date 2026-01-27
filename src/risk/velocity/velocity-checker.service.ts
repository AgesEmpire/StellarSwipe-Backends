import { Injectable, Logger } from '@nestjs/common';
import { TransactionLimitsService } from './transaction-limits.service';
import { LimitType } from './entities/transaction-limit.entity';

export interface VelocityCheckResult {
  allowed: boolean;
  reason?: string;
  coolingOffUntil?: Date;
  retryAfter?: number;
}

export interface TradeRequest {
  userId: string;
  amount: string;
  value: string;
  assetPair: string;
}

@Injectable()
export class VelocityCheckerService {
  private readonly logger = new Logger(VelocityCheckerService.name);
  private readonly recentTrades = new Map<string, Date[]>();
  private readonly RAPID_TRADE_THRESHOLD = 5; // trades
  private readonly RAPID_TRADE_WINDOW = 5 * 60 * 1000; // 5 minutes
  private readonly LARGE_LOSS_THRESHOLD = 1000; // USD value
  private readonly COOLING_OFF_DURATION = 30; // minutes

  constructor(
    private readonly limitsService: TransactionLimitsService,
  ) {}

  async checkVelocity(tradeRequest: TradeRequest): Promise<VelocityCheckResult> {
    const { userId, value } = tradeRequest;

    // Check cooling-off period
    if (await this.limitsService.isInCoolingOff(userId)) {
      return {
        allowed: false,
        reason: 'User is in cooling-off period',
      };
    }

    // Check rapid trading
    const rapidCheck = this.checkRapidTrading(userId);
    if (!rapidCheck.allowed) {
      return rapidCheck;
    }

    // Check hourly trade limit
    const hourlyCheck = await this.limitsService.checkLimit(
      userId,
      LimitType.HOURLY_TRADES,
      '1'
    );
    if (!hourlyCheck.allowed) {
      return {
        allowed: false,
        reason: 'Hourly trade limit exceeded',
        retryAfter: this.getRetryAfter(hourlyCheck.resetAt),
      };
    }

    // Check daily trade limit
    const dailyTradeCheck = await this.limitsService.checkLimit(
      userId,
      LimitType.DAILY_TRADES,
      '1'
    );
    if (!dailyTradeCheck.allowed) {
      return {
        allowed: false,
        reason: 'Daily trade limit exceeded',
        retryAfter: this.getRetryAfter(dailyTradeCheck.resetAt),
      };
    }

    // Check daily volume limit
    const dailyVolumeCheck = await this.limitsService.checkLimit(
      userId,
      LimitType.DAILY_VOLUME,
      value
    );
    if (!dailyVolumeCheck.allowed) {
      return {
        allowed: false,
        reason: 'Daily volume limit exceeded',
        retryAfter: this.getRetryAfter(dailyVolumeCheck.resetAt),
      };
    }

    // Check weekly volume limit
    const weeklyVolumeCheck = await this.limitsService.checkLimit(
      userId,
      LimitType.WEEKLY_VOLUME,
      value
    );
    if (!weeklyVolumeCheck.allowed) {
      return {
        allowed: false,
        reason: 'Weekly volume limit exceeded',
        retryAfter: this.getRetryAfter(weeklyVolumeCheck.resetAt),
      };
    }

    return { allowed: true };
  }

  async recordTrade(tradeRequest: TradeRequest): Promise<void> {
    const { userId, value } = tradeRequest;

    // Record trade timestamp for rapid trading detection
    this.recordTradeTimestamp(userId);

    // Consume limits
    await Promise.all([
      this.limitsService.consumeLimit(userId, LimitType.HOURLY_TRADES, '1'),
      this.limitsService.consumeLimit(userId, LimitType.DAILY_TRADES, '1'),
      this.limitsService.consumeLimit(userId, LimitType.DAILY_VOLUME, value),
      this.limitsService.consumeLimit(userId, LimitType.WEEKLY_VOLUME, value),
    ]);

    this.logger.debug(`Trade recorded for user ${userId}: ${value} USD`);
  }

  async handleLargeLoss(userId: string, lossAmount: string): Promise<void> {
    const loss = parseFloat(lossAmount);
    
    if (loss >= this.LARGE_LOSS_THRESHOLD) {
      await this.limitsService.setCoolingOff(userId, this.COOLING_OFF_DURATION);
      this.logger.warn(`Large loss detected for user ${userId}: ${loss} USD. Cooling-off applied.`);
    }
  }

  async overrideLimits(userId: string, reason: string, adminId: string): Promise<void> {
    // Reset all current usage for emergency override
    await this.limitsService.initializeUserLimits(userId);
    
    this.logger.warn(`Limits overridden for user ${userId} by admin ${adminId}. Reason: ${reason}`);
  }

  private checkRapidTrading(userId: string): VelocityCheckResult {
    const userTrades = this.recentTrades.get(userId) || [];
    const now = new Date();
    
    // Filter trades within the rapid trade window
    const recentTrades = userTrades.filter(
      tradeTime => now.getTime() - tradeTime.getTime() <= this.RAPID_TRADE_WINDOW
    );

    if (recentTrades.length >= this.RAPID_TRADE_THRESHOLD) {
      const oldestTrade = Math.min(...recentTrades.map(t => t.getTime()));
      const retryAfter = Math.ceil((oldestTrade + this.RAPID_TRADE_WINDOW - now.getTime()) / 1000);

      return {
        allowed: false,
        reason: 'Rapid trading detected. Please slow down.',
        retryAfter,
      };
    }

    return { allowed: true };
  }

  private recordTradeTimestamp(userId: string): void {
    const userTrades = this.recentTrades.get(userId) || [];
    const now = new Date();
    
    // Add current trade
    userTrades.push(now);
    
    // Clean old trades (keep only last hour for memory efficiency)
    const oneHourAgo = now.getTime() - 60 * 60 * 1000;
    const filteredTrades = userTrades.filter(t => t.getTime() > oneHourAgo);
    
    this.recentTrades.set(userId, filteredTrades);
  }

  private getRetryAfter(resetAt?: Date): number {
    if (!resetAt) return 3600; // Default 1 hour
    return Math.ceil((resetAt.getTime() - Date.now()) / 1000);
  }
}