import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PortfolioCacheStrategy } from './strategies/portfolio-cache.strategy';
import { CacheService } from './cache.service';
import { Trade } from '../trades/entities/trade.entity';

/**
 * TradeHistoryCacheService — caching for trade history / portfolio heavy-read endpoints.
 *
 * Provides cache-aside with invalidation hooks on trade write paths.
 *
 * Cache key patterns:
 *   - trades:history:{userId}:{page}:{limit} — paginated trade history
 *   - trades:summary:{userId} — aggregate summary
 *   - portfolio:{userId} — computed portfolio balances
 */
@Injectable()
export class TradeHistoryCacheService {
  private readonly logger = new Logger(TradeHistoryCacheService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly portfolioCacheStrategy: PortfolioCacheStrategy,
  ) {}

  private historyKey(userId: string, page: number, limit: number): string {
    return `trades:history:${userId}:${page}:${limit}`;
  }

  private summaryKey(userId: string): string {
    return `trades:summary:${userId}`;
  }

  /**
   * Get cached trade history page.
   */
  async getTradeHistory(userId: string, page: number, limit: number): Promise<any | null> {
    return this.cacheService.get(this.historyKey(userId, page, limit));
  }

  /**
   * Cache trade history page.
   */
  async setTradeHistory(userId: string, page: number, limit: number, data: any): Promise<void> {
    await this.cacheService.setWithTTL(this.historyKey(userId, page, limit), data, 60);
  }

  /**
   * Get cached trade summary.
   */
  async getTradeSummary(userId: string): Promise<any | null> {
    return this.cacheService.get(this.summaryKey(userId));
  }

  /**
   * Cache trade summary.
   */
  async setTradeSummary(userId: string, data: any): Promise<void> {
    await this.cacheService.setWithTTL(this.summaryKey(userId), data, 120);
  }

  /**
   * Invalidate all trade history and portfolio caches for a user.
   * Called on trade creation, close, or status change.
   */
  async invalidateOnTradeChange(userId: string): Promise<void> {
    const keysToInvalidate: string[] = [];

    // Invalidate all cached history pages (up to 50 pages)
    for (let page = 1; page <= 50; page++) {
      for (const limit of [20, 50, 100]) {
        keysToInvalidate.push(this.historyKey(userId, page, limit));
      }
    }

    // Invalidate summary
    keysToInvalidate.push(this.summaryKey(userId));

    // Invalidate portfolio
    await this.portfolioCacheStrategy.invalidatePortfolio(userId);

    await Promise.all(keysToInvalidate.map((k) => this.cacheService.del(k)));
    this.logger.debug(`Trade history cache invalidated for user ${userId}`);
  }
}
