import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../cache/cache.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationChannel } from '../notifications/entities/notification.entity';

export interface WalletBalance {
  available: string;
  locked: string;
  total: string;
  asset?: string;
}

export interface BalanceAlertContext {
  userId: string;
  walletAddress: string;
  balance: WalletBalance;
  /** Optional: the amount the user tried to trade that triggered the check */
  requestedTradeAmount?: number;
}

export interface AlertResult {
  alerted: boolean;
  /** false when cooldown is active */
  reason?: 'below_threshold' | 'cooldown_active' | 'balance_sufficient';
  currentBalance: string;
  minimumThreshold: string;
  estimatedTradeCapacity?: string;
}

const COOLDOWN_CACHE_PREFIX = 'stellarswipe:low_balance_alert:';

@Injectable()
export class LowBalanceAlertService {
  private readonly logger = new Logger(LowBalanceAlertService.name);
  private readonly minimumThreshold: number;
  /** Cooldown in seconds before the same user can receive another alert */
  private readonly cooldownSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly notificationService: NotificationService,
  ) {
    this.minimumThreshold = this.configService.get<number>(
      'trade.minimumBalanceThreshold',
      10,
    );
    this.cooldownSeconds = this.configService.get<number>(
      'alerts.lowBalanceCooldownSeconds',
      86_400, // 24 hours
    );
  }

  /**
   * Main entry point. Checks the wallet balance and dispatches an alert if:
   *  1. The available balance is below the configured minimum threshold, AND
   *  2. No alert has been sent for this user within the cooldown window.
   */
  async checkAndAlert(ctx: BalanceAlertContext): Promise<AlertResult> {
    const available = parseFloat(ctx.balance.available);
    const threshold = this.minimumThreshold;

    if (available >= threshold) {
      return {
        alerted: false,
        reason: 'balance_sufficient',
        currentBalance: ctx.balance.available,
        minimumThreshold: threshold.toString(),
      };
    }

    if (await this.isInCooldown(ctx.userId)) {
      this.logger.debug(
        `Low-balance alert suppressed for user=${ctx.userId} (cooldown active)`,
      );
      return {
        alerted: false,
        reason: 'cooldown_active',
        currentBalance: ctx.balance.available,
        minimumThreshold: threshold.toString(),
      };
    }

    const estimatedCapacity = this.estimateTradeCapacity(available, ctx.requestedTradeAmount);

    await this.dispatchAlert(ctx, available, threshold, estimatedCapacity);
    await this.markCooldown(ctx.userId);

    this.logger.log(
      `Low-balance alert sent for user=${ctx.userId} balance=${available} threshold=${threshold}`,
    );

    return {
      alerted: true,
      reason: 'below_threshold',
      currentBalance: ctx.balance.available,
      minimumThreshold: threshold.toString(),
      estimatedTradeCapacity: estimatedCapacity,
    };
  }

  /**
   * Returns true if an alert was sent within the cooldown window.
   */
  async isInCooldown(userId: string): Promise<boolean> {
    const key = `${COOLDOWN_CACHE_PREFIX}${userId}`;
    const sentinel = await this.cacheService.get<string>(key);
    return sentinel !== undefined && sentinel !== null;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async dispatchAlert(
    ctx: BalanceAlertContext,
    available: number,
    threshold: number,
    estimatedCapacity: string,
  ): Promise<void> {
    const shortfall = (threshold - available).toFixed(8);
    const asset = ctx.balance.asset ?? 'XLM';

    const title = 'Low Balance Warning';
    const message =
      `Your trading balance (${available.toFixed(8)} ${asset}) is below the minimum ` +
      `required threshold of ${threshold} ${asset}. ` +
      `You need at least ${shortfall} ${asset} more to place new trades. ` +
      `Estimated trade capacity with current balance: ${estimatedCapacity} ${asset}. ` +
      `Top up your wallet at ${ctx.walletAddress} to continue trading.`;

    await this.notificationService.send({
      userId: ctx.userId,
      type: 'LOW_BALANCE',
      channel: NotificationChannel.IN_APP,
      title,
      message,
      metadata: {
        walletAddress: ctx.walletAddress,
        currentBalance: ctx.balance.available,
        minimumThreshold: threshold.toString(),
        shortfall,
        estimatedTradeCapacity: estimatedCapacity,
        asset,
      },
    });
  }

  private async markCooldown(userId: string): Promise<void> {
    const key = `${COOLDOWN_CACHE_PREFIX}${userId}`;
    // Store a sentinel; TTL in milliseconds (cache-manager convention)
    await this.cacheService.setWithTTL(key, '1', this.cooldownSeconds);
  }

  /**
   * Estimates how many units of the base asset the user can trade at the
   * current balance given a typical fee of 0.1%.
   */
  private estimateTradeCapacity(
    available: number,
    requestedAmount?: number,
  ): string {
    const feeRate = this.configService.get<number>('trade.baseFeePercentage', 0.1) / 100;
    const capacity = available / (1 + feeRate);

    if (requestedAmount && requestedAmount > 0) {
      // Express shortfall as a percentage of the requested amount
      const coveragePct = ((capacity / requestedAmount) * 100).toFixed(2);
      return `${capacity.toFixed(8)} (${coveragePct}% of requested)`;
    }

    return capacity.toFixed(8);
  }
}
