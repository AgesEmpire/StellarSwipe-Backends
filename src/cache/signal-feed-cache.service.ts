import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PortfolioCacheStrategy } from './strategies/portfolio-cache.strategy';
import { CacheService } from './cache.service';

/**
 * Signals-specific cache integration.
 *
 * Provides high-level caching for the signals feed endpoint (heavy-read)
 * with automatic invalidation on write operations.
 *
 * Cache key patterns:
 *   - signals:feed:{sortBy}:{page}:{limit} — paginated feed
 *   - signals:feed:{asset}:{sortBy}:{page} — asset-filtered feed
 *   - signals:feed:provider:{providerId} — provider-specific feed
 *   - signals:detail:{signalId} — individual signal detail
 */
@Injectable()
export class SignalFeedCacheService {
  private readonly logger = new Logger(SignalFeedCacheService.name);

  constructor(
    private readonly cacheService: CacheService,
    private readonly portfolioCacheStrategy: PortfolioCacheStrategy,
  ) {}

  private feedKey(sortBy: string, page: number, limit: number): string {
    return `signals:feed:${sortBy}:${page}:${limit}`;
  }

  private assetFeedKey(asset: string, sortBy: string, page: number): string {
    return `signals:feed:${asset}:${sortBy}:${page}`;
  }

  private providerFeedKey(providerId: string): string {
    return `signals:feed:provider:${providerId}`;
  }

  private signalDetailKey(signalId: string): string {
    return `signals:detail:${signalId}`;
  }

  /**
   * Get cached signal feed page.
   */
  async getFeed(sortBy: string, page: number, limit: number): Promise<any | null> {
    return this.cacheService.get(this.feedKey(sortBy, page, limit));
  }

  /**
   * Cache signal feed page.
   */
  async setFeed(sortBy: string, page: number, limit: number, data: any): Promise<void> {
    await this.cacheService.setWithTTL(this.feedKey(sortBy, page, limit), data, 30);
  }

  /**
   * Get cached signal detail.
   */
  async getSignalDetail(signalId: string): Promise<any | null> {
    return this.cacheService.get(this.signalDetailKey(signalId));
  }

  /**
   * Cache signal detail.
   */
  async setSignalDetail(signalId: string, data: any): Promise<void> {
    await this.cacheService.setWithTTL(this.signalDetailKey(signalId), data, 120);
  }

  /**
   * Invalidate all feed caches when a signal is created/updated/deleted.
   * Also invalidates portfolio caches for affected users.
   */
  async invalidateOnSignalChange(
    signalId: string,
    providerId?: string,
  ): Promise<void> {
    const keysToInvalidate: string[] = [];

    // Invalidate feed pages for all sort orders
    for (const sortBy of ['ranked', 'recent', 'performance']) {
      for (let page = 1; page <= 10; page++) {
        keysToInvalidate.push(this.feedKey(sortBy, page, 20));
      }
    }

    // Invalidate provider-specific feed
    if (providerId) {
      keysToInvalidate.push(this.providerFeedKey(providerId));
      // Also invalidate portfolio for the provider
      await this.portfolioCacheStrategy.invalidatePortfolio(providerId);
    }

    // Invalidate individual signal detail
    keysToInvalidate.push(this.signalDetailKey(signalId));

    await Promise.all(keysToInvalidate.map((k) => this.cacheService.del(k)));
    this.logger.debug(`Signal feed cache invalidated for signal ${signalId}`);
  }
}
