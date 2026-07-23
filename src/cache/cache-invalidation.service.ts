import { Injectable, Logger } from '@nestjs/common';
import { CacheService, CachePrefix, tenantKey } from './cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

/** All user-data cache keys are namespaced under this prefix. */
const USER_PREFIX = 'stellarswipe:user:';

/** Cache key builders – centralised so invalidation is always consistent. */
export const UserCacheKeys = {
  profile: (userId: string, tenantId = 'default') =>
    tenantKey(CachePrefix.USER_PROFILE, tenantId, `${userId}:profile`),
  preferences: (userId: string, tenantId = 'default') =>
    tenantKey(CachePrefix.USER_PROFILE, tenantId, `${userId}:preferences`),
  sessions: (userId: string) => `${USER_PREFIX}${userId}:sessions`,
  portfolio: (userId: string) => `${CachePrefix.PORTFOLIO}${userId}`,
};

/** Signal and feed-related cache keys */
export const SignalCacheKeys = {
  signal: (signalId: string) => `${CachePrefix.SIGNAL}${signalId}`,
  feedPage: (page: number, sortBy?: string) =>
    `${CachePrefix.SIGNAL}feed:${sortBy || 'ranked'}:${page}`,
  feedAsset: (asset: string, page: number) =>
    `${CachePrefix.SIGNAL}feed:${asset}:${page}`,
  feedProvider: (providerId: string, page: number) =>
    `${CachePrefix.SIGNAL}feed:provider:${providerId}:${page}`,
  allFeed: () => `${CachePrefix.SIGNAL}feed`,
  userSignals: (userId: string) => `${CachePrefix.SIGNAL}user:${userId}`,
};

/** Analytics dashboard cache keys */
export const AnalyticsCacheKeys = {
  dashboard: (tenantId: string, period: string) =>
    tenantKey(CachePrefix.ANALYTICS, tenantId, `dashboard:${period}`),
  snapshot: (tenantId: string, period: string, date: string) =>
    tenantKey(CachePrefix.ANALYTICS, tenantId, `snapshot:${period}:${date}`),
};

/** Market data cache keys */
export const MarketCacheKeys = {
  price: (tenantId: string, assetPair: string) =>
    tenantKey(CachePrefix.MARKET, tenantId, `price:${assetPair}`),
  history: (tenantId: string, assetPair: string) =>
    tenantKey(CachePrefix.MARKET, tenantId, `history:${assetPair}`),
};

/** Leaderboard and portfolio cache keys */
export const LeaderboardCacheKeys = {
  overall: (page: number) => `stellarswipe:leaderboard:overall:${page}`,
  assetSpecific: (asset: string, page: number) =>
    `stellarswipe:leaderboard:${asset}:${page}`,
  userRank: (userId: string) => `stellarswipe:leaderboard:user:${userId}`,
  topPerformers: () => `stellarswipe:leaderboard:top-performers`,
};

@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger(CacheInvalidationService.name);

  constructor(
    private readonly cacheService: CacheService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Invalidate all cache entries that belong to a single user.
   * Call this whenever any user data changes (profile, preferences, sessions).
   */
  async invalidateUser(userId: string, tenantId = 'default'): Promise<void> {
    const keys = [
      UserCacheKeys.profile(userId, tenantId),
      UserCacheKeys.preferences(userId, tenantId),
      UserCacheKeys.sessions(userId),
      UserCacheKeys.portfolio(userId),
    ];

    await Promise.all(keys.map((k) => this.cacheService.del(k)));
    this.logger.log(`Cache invalidated for user ${userId}`);
    this.eventEmitter.emit('cache.invalidated.user', { userId });
  }

  /** Invalidate only the user's profile cache entry. */
  async invalidateUserProfile(
    userId: string,
    tenantId = 'default',
  ): Promise<void> {
    await this.cacheService.del(UserCacheKeys.profile(userId, tenantId));
    this.logger.log(`Profile cache invalidated for user ${userId}`);
  }

  /** Invalidate only the user's preferences cache entry. */
  async invalidateUserPreferences(
    userId: string,
    tenantId = 'default',
  ): Promise<void> {
    await this.cacheService.del(UserCacheKeys.preferences(userId, tenantId));
    this.logger.log(`Preferences cache invalidated for user ${userId}`);
  }

  /** Invalidate only the user's sessions cache entry. */
  async invalidateUserSessions(userId: string): Promise<void> {
    await this.cacheService.del(UserCacheKeys.sessions(userId));
    this.logger.log(`Sessions cache invalidated for user ${userId}`);
  }

  /** Invalidate cache for multiple users at once (e.g. bulk admin operations). */
  async invalidateUsers(
    userIds: string[],
    tenantId = 'default',
  ): Promise<void> {
    await Promise.all(userIds.map((id) => this.invalidateUser(id, tenantId)));
  }

  /** Invalidate analytics dashboard cache for a tenant+period. */
  async invalidateAnalytics(tenantId: string, period: string): Promise<void> {
    await this.cacheService.del(AnalyticsCacheKeys.dashboard(tenantId, period));
    this.logger.log(
      `Analytics cache invalidated for tenant ${tenantId}, period ${period}`,
    );
  }

  /** Invalidate a single analytics snapshot. */
  async invalidateAnalyticsSnapshot(
    tenantId: string,
    period: string,
    date: string,
  ): Promise<void> {
    await this.cacheService.del(
      AnalyticsCacheKeys.snapshot(tenantId, period, date),
    );
  }

  /** Invalidate market data (price + history) for an asset pair. */
  async invalidateMarketData(
    tenantId: string,
    assetPair: string,
  ): Promise<void> {
    await Promise.all([
      this.cacheService.del(MarketCacheKeys.price(tenantId, assetPair)),
      this.cacheService.del(MarketCacheKeys.history(tenantId, assetPair)),
    ]);
    this.logger.log(
      `Market cache invalidated for ${assetPair} (tenant: ${tenantId})`,
    );
  }

  /**
   * #532 — Invalidate cache entries when a signal is updated.
   * This ensures feed, leaderboard, and provider-specific caches are refreshed.
   */
  async invalidateSignalUpdate(
    signalId: string,
    assetPair?: string,
    providerId?: string,
  ): Promise<void> {
    const keysToInvalidate: string[] = [
      SignalCacheKeys.signal(signalId),
      SignalCacheKeys.allFeed(),
    ];

    // Invalidate feed pages (for all sorts and pagination)
    for (let page = 1; page <= 10; page++) {
      keysToInvalidate.push(SignalCacheKeys.feedPage(page, 'ranked'));
      keysToInvalidate.push(SignalCacheKeys.feedPage(page, 'recent'));
      keysToInvalidate.push(SignalCacheKeys.feedPage(page, 'performance'));
    }

    // Invalidate asset-specific feed if asset pair is provided
    if (assetPair) {
      for (let page = 1; page <= 10; page++) {
        keysToInvalidate.push(SignalCacheKeys.feedAsset(assetPair, page));
      }
    }

    // Invalidate provider-specific feed if provider ID is provided
    if (providerId) {
      for (let page = 1; page <= 10; page++) {
        keysToInvalidate.push(SignalCacheKeys.feedProvider(providerId, page));
      }
      keysToInvalidate.push(SignalCacheKeys.userSignals(providerId));
    }

    await Promise.all(keysToInvalidate.map((k) => this.cacheService.del(k)));
    this.logger.log(
      `Signal cache invalidated: signalId=${signalId}, asset=${assetPair}, provider=${providerId}`,
    );
    this.eventEmitter.emit('cache.invalidated.signal', {
      signalId,
      assetPair,
      providerId,
      timestamp: new Date(),
    });
  }

  /**
   * #532 — Invalidate portfolio and leaderboard cache entries after a trade completes.
   * This ensures user rankings and portfolio stats are fresh.
   */
  async invalidateAfterTrade(
    userId: string,
    assetPair?: string,
    tradeAmount?: string,
  ): Promise<void> {
    const keysToInvalidate: string[] = [
      UserCacheKeys.portfolio(userId),
      LeaderboardCacheKeys.userRank(userId),
      LeaderboardCacheKeys.topPerformers(),
    ];

    // Invalidate overall leaderboard pages
    for (let page = 1; page <= 10; page++) {
      keysToInvalidate.push(LeaderboardCacheKeys.overall(page));
    }

    // Invalidate asset-specific leaderboards if asset pair is provided
    if (assetPair) {
      for (let page = 1; page <= 10; page++) {
        keysToInvalidate.push(
          LeaderboardCacheKeys.assetSpecific(assetPair, page),
        );
      }
    }

    await Promise.all(keysToInvalidate.map((k) => this.cacheService.del(k)));
    this.logger.log(
      `Portfolio and leaderboard cache invalidated: userId=${userId}, asset=${assetPair}`,
    );
    this.eventEmitter.emit('cache.invalidated.trade', {
      userId,
      assetPair,
      tradeAmount,
      timestamp: new Date(),
    });
  }

  /**
   * #532 — Invalidate dashboard cache for a specific user.
   * This includes all aggregated dashboard data.
   */
  async invalidateDashboard(userId: string): Promise<void> {
    const keysToInvalidate: string[] = [
      `stellarswipe:dashboard:${userId}:overview`,
      `stellarswipe:dashboard:${userId}:performance`,
      `stellarswipe:dashboard:${userId}:signals`,
      `stellarswipe:dashboard:${userId}:portfolio`,
    ];

    await Promise.all(keysToInvalidate.map((k) => this.cacheService.del(k)));
    this.logger.log(`Dashboard cache invalidated for user ${userId}`);
    this.eventEmitter.emit('cache.invalidated.dashboard', { userId });
  }

  /**
   * #532 — Invalidate all feed-related caches (comprehensive invalidation).
   */
  async invalidateAllFeeds(): Promise<void> {
    this.logger.log('Invalidating all feed caches');
    // In production, use Redis KEYS pattern to delete all matching keys
    // For now, we'll emit an event and rely on the caching strategy
    this.eventEmitter.emit('cache.invalidated.all-feeds', {
      timestamp: new Date(),
    });
  }

  /**
   * #532 — Get cache invalidation metrics for monitoring.
   */
  getInvalidationMetrics(): {
    listenersAttached: number;
    eventNameList: string[];
  } {
    return {
      listenersAttached:
        this.eventEmitter.listenerCount('cache.invalidated.signal') +
        this.eventEmitter.listenerCount('cache.invalidated.trade') +
        this.eventEmitter.listenerCount('cache.invalidated.user') +
        this.eventEmitter.listenerCount('cache.invalidated.dashboard'),
      eventNameList: [
        'cache.invalidated.signal',
        'cache.invalidated.trade',
        'cache.invalidated.user',
        'cache.invalidated.dashboard',
      ],
    };
  }
}
