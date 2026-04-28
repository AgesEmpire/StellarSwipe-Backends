import { Injectable, Logger } from '@nestjs/common';
import { CacheService, CachePrefix } from './cache.service';

/** All user-data cache keys are namespaced under this prefix. */
const USER_PREFIX = 'stellarswipe:user:';

/** Cache key builders – centralised so invalidation is always consistent. */
export const UserCacheKeys = {
  profile: (userId: string) => `${USER_PREFIX}${userId}:profile`,
  preferences: (userId: string) => `${USER_PREFIX}${userId}:preferences`,
  sessions: (userId: string) => `${USER_PREFIX}${userId}:sessions`,
  portfolio: (userId: string) => `${CachePrefix.PORTFOLIO}${userId}`,
};

@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger(CacheInvalidationService.name);

  constructor(private readonly cacheService: CacheService) {}

  /**
   * Invalidate all cache entries that belong to a single user.
   * Call this whenever any user data changes (profile, preferences, sessions).
   */
  async invalidateUser(userId: string): Promise<void> {
    const keys = [
      UserCacheKeys.profile(userId),
      UserCacheKeys.preferences(userId),
      UserCacheKeys.sessions(userId),
      UserCacheKeys.portfolio(userId),
    ];

    await Promise.all(keys.map((k) => this.cacheService.del(k)));
    this.logger.log(`Cache invalidated for user ${userId}`);
  }

  /** Invalidate only the user's profile cache entry. */
  async invalidateUserProfile(userId: string): Promise<void> {
    await this.cacheService.del(UserCacheKeys.profile(userId));
    this.logger.log(`Profile cache invalidated for user ${userId}`);
  }

  /** Invalidate only the user's preferences cache entry. */
  async invalidateUserPreferences(userId: string): Promise<void> {
    await this.cacheService.del(UserCacheKeys.preferences(userId));
    this.logger.log(`Preferences cache invalidated for user ${userId}`);
  }

  /** Invalidate only the user's sessions cache entry. */
  async invalidateUserSessions(userId: string): Promise<void> {
    await this.cacheService.del(UserCacheKeys.sessions(userId));
    this.logger.log(`Sessions cache invalidated for user ${userId}`);
  }

  /** Invalidate cache for multiple users at once (e.g. bulk admin operations). */
  async invalidateUsers(userIds: string[]): Promise<void> {
    await Promise.all(userIds.map((id) => this.invalidateUser(id)));
  }
}
