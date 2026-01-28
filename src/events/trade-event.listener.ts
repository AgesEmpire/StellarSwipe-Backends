import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TradeExecutedEvent, TradeFailedEvent, TradeCancelledEvent } from '../events/trade.events';

@Injectable()
export class TradeEventListener {
  private readonly logger = new Logger(TradeEventListener.name);

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
    this.logger.warn(`Handling trade failed event: ${event.tradeId}`, {
      tradeId: event.tradeId,
      userId: event.userId,
      reason: event.reason,
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

  private async notifyUserOfFailure(event: TradeFailedEvent): Promise<void> {
    this.logger.debug(`Notifying user: ${event.userId} about trade failure`);
    // TODO: Implement failure notification
    // await this.notificationService.sendTradeFailureNotification(event);
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

  private async releaseReservedFunds(event: TradeCancelledEvent): Promise<void> {
    this.logger.debug(`Releasing reserved funds for trade: ${event.tradeId}`);
    // TODO: Implement fund release logic
    // await this.walletService.releaseReservation(event.tradeId);
  }
}