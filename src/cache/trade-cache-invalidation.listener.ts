import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CacheInvalidationService } from './cache-invalidation.service';

/**
 * #532 — Trade Cache Invalidation Listener
 *
 * This service listens for trade completion events and invalidates
 * portfolio and leaderboard caches to reflect updated user performance
 * and rankings. This ensures that dashboard and leaderboard displays
 * are always current with the latest trade data.
 */
@Injectable()
export class TradeCacheInvalidationListener {
  private readonly logger = new Logger(TradeCacheInvalidationListener.name);

  constructor(private cacheInvalidationService: CacheInvalidationService) {}

  /**
   * Listen for trade execution completions.
   */
  @OnEvent('trade.executed', { async: true })
  async handleTradeExecuted(payload: {
    tradeId: string;
    userId: string;
    baseAsset: string;
    counterAsset: string;
    amount: string;
    entryPrice: string;
    status: string;
  }): Promise<void> {
    try {
      this.logger.debug(`Trade executed: ${payload.tradeId} for user ${payload.userId}`);
      const assetPair = `${payload.baseAsset}/${payload.counterAsset}`;
      await this.cacheInvalidationService.invalidateAfterTrade(
        payload.userId,
        assetPair,
        payload.amount,
      );
    } catch (error) {
      this.logger.error('Error handling trade execution cache invalidation', error);
    }
  }

  /**
   * Listen for trade closure events.
   */
  @OnEvent('trade.closed', { async: true })
  async handleTradeClosed(payload: {
    tradeId: string;
    userId: string;
    baseAsset: string;
    counterAsset: string;
    profitLoss: string;
    status: string;
  }): Promise<void> {
    try {
      this.logger.debug(
        `Trade closed: ${payload.tradeId} with P/L ${payload.profitLoss} for user ${payload.userId}`,
      );
      const assetPair = `${payload.baseAsset}/${payload.counterAsset}`;
      await this.cacheInvalidationService.invalidateAfterTrade(
        payload.userId,
        assetPair,
      );
      // Also invalidate dashboard to reflect performance changes
      await this.cacheInvalidationService.invalidateDashboard(payload.userId);
    } catch (error) {
      this.logger.error('Error handling trade closure cache invalidation', error);
    }
  }

  /**
   * Listen for portfolio updates.
   */
  @OnEvent('portfolio.updated', { async: true })
  async handlePortfolioUpdated(payload: {
    userId: string;
    totalValue: string;
    profitLoss: string;
    changedAssets: string[];
  }): Promise<void> {
    try {
      this.logger.debug(`Portfolio updated for user ${payload.userId}`);
      await this.cacheInvalidationService.invalidateDashboard(payload.userId);
      // Invalidate leaderboard as ranking may have changed
      for (const asset of payload.changedAssets) {
        await this.cacheInvalidationService.invalidateAfterTrade(
          payload.userId,
          asset,
        );
      }
    } catch (error) {
      this.logger.error('Error handling portfolio update cache invalidation', error);
    }
  }

  /**
   * Listen for user performance metric updates.
   */
  @OnEvent('metrics.updated', { async: true })
  async handleMetricsUpdated(payload: {
    userId: string;
    metricType: string;
  }): Promise<void> {
    try {
      this.logger.debug(
        `Metrics updated for user ${payload.userId}: ${payload.metricType}`,
      );
      await this.cacheInvalidationService.invalidateDashboard(payload.userId);
    } catch (error) {
      this.logger.error('Error handling metrics update cache invalidation', error);
    }
  }
}
