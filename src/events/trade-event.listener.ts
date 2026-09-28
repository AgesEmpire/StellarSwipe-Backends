import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { TradeExecutedEvent, TradeFailedEvent, TradeCancelledEvent } from '../events/trade.events';
import { NotificationService } from '../notifications/notification.service';
import { NotificationChannel, NotificationType } from '../notifications/entities/notification.entity';
import { Trade, TradeStatus } from '../trades/entities/trade.entity';

/** Safe, user-facing messages keyed by known failure reason codes. */
const SAFE_FAILURE_REASONS: Record<string, string> = {
  INSUFFICIENT_BALANCE: 'Insufficient balance to complete the trade.',
  SLIPPAGE_EXCEEDED: 'The price moved beyond your slippage tolerance.',
  NO_LIQUIDITY: 'Not enough market liquidity to fill the order.',
  TIMEOUT: 'The network did not confirm the trade in time.',
  RISK_LIMIT: 'The trade exceeds your configured risk limits.',
};
const DEFAULT_FAILURE_MESSAGE = 'Your trade could not be completed. Please try again later.';

/** Statuses from which reserved funds can no longer be released. */
const NON_RELEASABLE_STATUSES = new Set<TradeStatus>([
  TradeStatus.SETTLED,
  TradeStatus.COMPLETED,
  TradeStatus.CONFIRMED,
]);

const MAX_DEDUPE_KEYS = 10_000;

export function toSafeFailureMessage(reason?: string): string {
  const code = (reason ?? '').trim().toUpperCase();
  return SAFE_FAILURE_REASONS[code] ?? DEFAULT_FAILURE_MESSAGE;
}

@Injectable()
export class TradeEventListener {
  private readonly logger = new Logger(TradeEventListener.name);
  private readonly notifiedFailures = new Set<string>();

  constructor(
    @Optional() private readonly notificationService?: NotificationService,
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  /**
   * Handle trade executed event
   * Responsibilities:
   * - Update portfolio
   * - Notify user
   * - Update signal statistics
   * - Update leaderboard
   */
  @OnEvent('trade.executed', { async: true })
  async handleTradeExecuted(event: TradeExecutedEvent): Promise<void> {
    this.logger.log(`Handling trade executed event: ${event.tradeId}`, {
      tradeId: event.tradeId,
      userId: event.userId,
      symbol: event.symbol,
      correlationId: event.correlationId,
    });

    try {
      // Update portfolio in parallel for better performance
      await Promise.allSettled([
        this.updatePortfolio(event),
        this.notifyUser(event),
        this.updateSignalStats(event),
        this.updateLeaderboard(event),
      ]);

      this.logger.log(`Trade executed event processed successfully: ${event.tradeId}`);
    } catch (error) {
      this.logger.error(
        `Failed to process trade executed event: ${event.tradeId}`,
        error.stack,
        {
          tradeId: event.tradeId,
          userId: event.userId,
          correlationId: event.correlationId,
          error: error.message,
        },
      );
      // Don't throw - we don't want to block other listeners
      // Instead, log the error and potentially queue for retry
    }
  }

  /**
   * Handle trade failed event
   */
  @OnEvent('trade.failed', { async: true })
  async handleTradeFailed(event: TradeFailedEvent): Promise<void> {
    // Raw reason may contain provider payloads/credentials - never log it.
    this.logger.warn(`Handling trade failed event: ${event.tradeId}`, {
      tradeId: event.tradeId,
      userId: event.userId,
      correlationId: event.correlationId,
    });

    try {
      await Promise.allSettled([
        this.notifyUserOfFailure(event),
        this.logTradeFailure(event),
        this.updateFailureMetrics(event),
      ]);

      this.logger.log(`Trade failed event processed: ${event.tradeId}`);
    } catch (error) {
      this.logger.error(
        `Failed to process trade failed event: ${event.tradeId}`,
        error.stack,
      );
    }
  }

  /**
   * Handle trade cancelled event
   */
  @OnEvent('trade.cancelled', { async: true })
  async handleTradeCancelled(event: TradeCancelledEvent): Promise<void> {
    this.logger.log(`Handling trade cancelled event: ${event.tradeId}`, {
      tradeId: event.tradeId,
      userId: event.userId,
      reason: event.reason,
      correlationId: event.correlationId,
    });

    try {
      await Promise.allSettled([
        this.notifyUserOfCancellation(event),
        this.releaseReservedFunds(event),
      ]);

      this.logger.log(`Trade cancelled event processed: ${event.tradeId}`);
    } catch (error) {
      this.logger.error(
        `Failed to process trade cancelled event: ${event.tradeId}`,
        error.stack,
      );
    }
  }

  // Private helper methods
  private async updatePortfolio(event: TradeExecutedEvent): Promise<void> {
    this.logger.debug(`Updating portfolio for user: ${event.userId}`);
    // TODO: Implement portfolio update logic
    // await this.portfolioService.updateAfterTrade(event);
  }

  private async notifyUser(event: TradeExecutedEvent): Promise<void> {
    this.logger.debug(`Notifying user: ${event.userId} about trade execution`);
    // TODO: Implement notification logic
    // await this.notificationService.sendTradeNotification(event);
  }

  private async updateSignalStats(event: TradeExecutedEvent): Promise<void> {
    if (!event.signalId) return;
    
    this.logger.debug(`Updating signal stats: ${event.signalId}`);
    // TODO: Implement signal stats update
    // await this.signalService.updateStats(event.signalId, event);
  }

  private async updateLeaderboard(event: TradeExecutedEvent): Promise<void> {
    this.logger.debug(`Updating leaderboard for user: ${event.userId}`);
    // TODO: Implement leaderboard update
    // await this.leaderboardService.updateAfterTrade(event);
  }

  async notifyUserOfFailure(event: TradeFailedEvent): Promise<void> {
    if (!this.notificationService) return;
    // Retries of the same failure must not produce duplicate notifications.
    const key = `${event.tradeId}:${event.correlationId ?? ''}`;
    if (this.notifiedFailures.has(key)) {
      this.logger.debug(`Skipping duplicate failure notification for trade ${event.tradeId}`);
      return;
    }
    this.notifiedFailures.add(key);
    if (this.notifiedFailures.size > MAX_DEDUPE_KEYS) {
      this.notifiedFailures.delete(this.notifiedFailures.values().next().value as string);
    }

    try {
      await this.notificationService.send({
        userId: event.userId,
        type: NotificationType.TRADE_FAILED,
        title: 'Trade failed',
        message: toSafeFailureMessage(event.reason),
        channel: NotificationChannel.IN_APP,
        metadata: { tradeId: event.tradeId, correlationId: event.correlationId },
      });
    } catch (error) {
      this.notifiedFailures.delete(key); // allow a later retry to deliver
      this.logger.error(`Failure notification not sent for trade ${event.tradeId}`, {
        correlationId: event.correlationId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  private async logTradeFailure(event: TradeFailedEvent): Promise<void> {
    this.logger.debug(`Logging trade failure: ${event.tradeId}`);
    // TODO: Implement failure logging to analytics
    // await this.analyticsService.logTradeFailure(event);
  }

  private async updateFailureMetrics(event: TradeFailedEvent): Promise<void> {
    this.logger.debug(`Updating failure metrics for user: ${event.userId}`);
    // TODO: Implement metrics update
    // await this.metricsService.incrementTradeFailures(event.userId);
  }

  private async notifyUserOfCancellation(event: TradeCancelledEvent): Promise<void> {
    this.logger.debug(`Notifying user: ${event.userId} about trade cancellation`);
    // TODO: Implement cancellation notification
    // await this.notificationService.sendTradeCancellationNotification(event);
  }

  /**
   * Releases the reservation for a cancelled trade exactly once.
   * Runs in a transaction with a row lock so concurrent/retried or
   * out-of-order events cannot double-release; any error rolls back.
   * Returns true only when funds were actually released.
   */
  async releaseReservedFunds(event: TradeCancelledEvent): Promise<boolean> {
    if (!this.dataSource) return false;

    return this.dataSource.transaction(async (manager) => {
      const trade = await manager.getRepository(Trade).findOne({
        where: { id: event.tradeId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!trade) {
        this.logger.warn(`Cannot release funds: trade ${event.tradeId} not found`);
        return false;
      }
      if (trade.metadata?.fundsReleasedAt) {
        this.logger.debug(`Funds already released for trade ${trade.id}`);
        return false;
      }
      if (NON_RELEASABLE_STATUSES.has(trade.status)) {
        this.logger.warn(`Trade ${trade.id} is ${trade.status}; reservation not released`);
        return false;
      }

      trade.status = TradeStatus.CANCELLED;
      trade.metadata = {
        ...(trade.metadata ?? {}),
        fundsReleasedAt: new Date().toISOString(),
        releasedAmount: trade.totalValue,
        releaseCorrelationId: event.correlationId,
      };
      await manager.getRepository(Trade).save(trade);

      this.logger.log(`Released reserved funds for trade ${trade.id}`, {
        correlationId: event.correlationId,
      });
      return true;
    });
  }
}