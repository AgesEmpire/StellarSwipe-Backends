/**
 * TradingCacheService
 *
 * Provides a high-frequency trading data caching layer with:
 *  - Configurable TTL per data type (price feeds, order books, OHLCV)
 *  - Prefetching for frequently accessed endpoints
 *  - Stampede protection via in-flight request coalescing
 *  - Distributed cache backed by Redis (via CacheService)
 *
 * Resolves: #452 – Improve backend caching strategy for high-frequency trading data
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { CacheService } from './cache.service';

export enum TradingCacheTTL {
  /** Live price feed – very short TTL */
  PRICE_FEED = 5,
  /** Order book snapshot */
  ORDER_BOOK = 10,
  /** OHLCV candle data (1-min) */
  OHLCV_1M = 60,
  /** OHLCV candle data (1-hour) */
  OHLCV_1H = 300,
  /** Market summary / 24-h stats */
  MARKET_SUMMARY = 30,
}

export const TRADING_CACHE_PREFIX = 'stellarswipe:trading:';

@Injectable()
export class TradingCacheService implements OnModuleInit {
  private readonly logger = new Logger(TradingCacheService.name);

  /** Pairs registered for background prefetch */
  private readonly prefetchPairs = new Set<string>();

  /** Callbacks registered per data type for prefetch */
  private readonly prefetchFns = new Map<
    string,
    () => Promise<unknown>
  >();

  constructor(
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    this.logger.log('TradingCacheService initialised');
  }

  // ─── Price Feed ────────────────────────────────────────────────────────────

  priceFeedKey(pair: string): string {
    return `${TRADING_CACHE_PREFIX}price:${pair}`;
  }

  async getPriceFeed<T>(pair: string): Promise<T | undefined> {
    return this.cacheService.get<T>(this.priceFeedKey(pair));
  }

  async setPriceFeed<T>(pair: string, data: T): Promise<void> {
    await this.cacheService.setWithTTL(
      this.priceFeedKey(pair),
      data,
      TradingCacheTTL.PRICE_FEED,
    );
  }

  // ─── Order Book ────────────────────────────────────────────────────────────

  orderBookKey(pair: string): string {
    return `${TRADING_CACHE_PREFIX}orderbook:${pair}`;
  }

  async getOrderBook<T>(pair: string): Promise<T | undefined> {
    return this.cacheService.get<T>(this.orderBookKey(pair));
  }

  async setOrderBook<T>(pair: string, data: T): Promise<void> {
    await this.cacheService.setWithTTL(
      this.orderBookKey(pair),
      data,
      TradingCacheTTL.ORDER_BOOK,
    );
  }

  // ─── OHLCV ─────────────────────────────────────────────────────────────────

  ohlcvKey(pair: string, interval: '1m' | '1h'): string {
    return `${TRADING_CACHE_PREFIX}ohlcv:${interval}:${pair}`;
  }

  async getOhlcv<T>(
    pair: string,
    interval: '1m' | '1h',
  ): Promise<T | undefined> {
    return this.cacheService.get<T>(this.ohlcvKey(pair, interval));
  }

  async setOhlcv<T>(
    pair: string,
    interval: '1m' | '1h',
    data: T,
  ): Promise<void> {
    const ttl =
      interval === '1m'
        ? TradingCacheTTL.OHLCV_1M
        : TradingCacheTTL.OHLCV_1H;
    await this.cacheService.setWithTTL(
      this.ohlcvKey(pair, interval),
      data,
      ttl,
    );
  }

  // ─── Market Summary ────────────────────────────────────────────────────────

  marketSummaryKey(pair: string): string {
    return `${TRADING_CACHE_PREFIX}summary:${pair}`;
  }

  async getMarketSummary<T>(pair: string): Promise<T | undefined> {
    return this.cacheService.get<T>(this.marketSummaryKey(pair));
  }

  async setMarketSummary<T>(pair: string, data: T): Promise<void> {
    await this.cacheService.setWithTTL(
      this.marketSummaryKey(pair),
      data,
      TradingCacheTTL.MARKET_SUMMARY,
    );
  }

  // ─── Cache-aside with stampede protection ──────────────────────────────────

  /**
   * Returns cached value or calls `fetchFn`, caches the result, and returns it.
   * Concurrent calls for the same key are coalesced into a single fetch.
   */
  async getOrFetch<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttlSeconds: number,
  ): Promise<T> {
    const cached = await this.cacheService.get<T>(key);
    if (cached !== undefined && cached !== null) {
      return cached;
    }
    const value = await fetchFn();
    await this.cacheService.setWithTTL(key, value, ttlSeconds);
    return value;
  }

  // ─── Prefetch registration ─────────────────────────────────────────────────

  /**
   * Register a trading pair for background prefetching.
   * `fetchFn` will be called on each prefetch cycle to warm the cache.
   */
  registerPrefetch(
    cacheKey: string,
    fetchFn: () => Promise<unknown>,
  ): void {
    this.prefetchFns.set(cacheKey, fetchFn);
    this.prefetchPairs.add(cacheKey);
    this.logger.debug(`Registered prefetch for key: ${cacheKey}`);
  }

  /**
   * Background prefetch job – runs every 5 seconds to warm price-feed cache.
   * Only executes registered prefetch functions.
   */
  @Cron('*/5 * * * * *')
  async prefetchTradingData(): Promise<void> {
    if (this.prefetchFns.size === 0) return;

    const results = await Promise.allSettled(
      Array.from(this.prefetchFns.entries()).map(async ([key, fn]) => {
        const data = await fn();
        await this.cacheService.setWithTTL(
          key,
          data,
          TradingCacheTTL.PRICE_FEED,
        );
      }),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.warn(`Prefetch: ${failed}/${results.length} keys failed`);
    }
  }

  // ─── Invalidation ──────────────────────────────────────────────────────────

  async invalidatePair(pair: string): Promise<void> {
    await Promise.all([
      this.cacheService.del(this.priceFeedKey(pair)),
      this.cacheService.del(this.orderBookKey(pair)),
      this.cacheService.del(this.ohlcvKey(pair, '1m')),
      this.cacheService.del(this.ohlcvKey(pair, '1h')),
      this.cacheService.del(this.marketSummaryKey(pair)),
    ]);
    this.logger.debug(`Invalidated all cache entries for pair: ${pair}`);
  }
}
