import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';

export interface QuotaConfig {
  /** Max submissions allowed per window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

export interface QuotaStatus {
  providerId: string;
  used: number;
  limit: number;
  remaining: number;
  resetAt: Date;
}

/** Default quota tiers keyed by tier name */
const QUOTA_TIERS: Record<string, QuotaConfig> = {
  basic: { limit: 10, windowSeconds: 86400 },       // 10/day
  silver: { limit: 50, windowSeconds: 86400 },      // 50/day
  gold: { limit: 200, windowSeconds: 86400 },       // 200/day
  platinum: { limit: 1000, windowSeconds: 86400 },  // 1000/day
  premium: { limit: 500, windowSeconds: 3600 },     // 500/hour (premium signal tier)
  staked: { limit: 100, windowSeconds: 86400 },     // 100/day for staked providers
};

const CACHE_PREFIX = 'signal_quota:';

@Injectable()
export class SignalQuotaService {
  private readonly logger = new Logger(SignalQuotaService.name);

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  /**
   * Check and increment quota for a provider.
   * Throws ForbiddenException when quota is exceeded.
   */
  async checkAndConsume(
    providerId: string,
    tier: string = 'basic',
    isStaked = false,
  ): Promise<QuotaStatus> {
    const config = this.resolveConfig(tier, isStaked);
    const key = this.cacheKey(providerId, tier);

    const current = (await this.cache.get<number>(key)) ?? 0;

    if (current >= config.limit) {
      const resetAt = await this.getResetAt(providerId, tier, config);
      this.logger.warn(
        `Quota exceeded for provider ${providerId} (tier=${tier}): ${current}/${config.limit}`,
      );
      throw new ForbiddenException({
        message: 'errors.QUOTA_EXCEEDED',
        resetAt: resetAt.toISOString(),
        used: current,
        limit: config.limit,
      });
    }

    const next = current + 1;
    // Only set TTL on first write so the window is anchored to first submission
    if (current === 0) {
      await this.cache.set(key, next, config.windowSeconds * 1000);
    } else {
      await this.cache.set(key, next);
    }

    const resetAt = await this.getResetAt(providerId, tier, config);
    return {
      providerId,
      used: next,
      limit: config.limit,
      remaining: config.limit - next,
      resetAt,
    };
  }

  async getStatus(
    providerId: string,
    tier: string = 'basic',
    isStaked = false,
  ): Promise<QuotaStatus> {
    const config = this.resolveConfig(tier, isStaked);
    const key = this.cacheKey(providerId, tier);
    const used = (await this.cache.get<number>(key)) ?? 0;
    const resetAt = await this.getResetAt(providerId, tier, config);

    return {
      providerId,
      used,
      limit: config.limit,
      remaining: Math.max(0, config.limit - used),
      resetAt,
    };
  }

  /** Manually reset quota (admin use). */
  async resetQuota(providerId: string, tier: string = 'basic'): Promise<void> {
    const key = this.cacheKey(providerId, tier);
    await this.cache.del(key);
    await this.cache.del(this.resetKey(providerId, tier));
    this.logger.log(`Quota reset for provider ${providerId} (tier=${tier})`);
  }

  private resolveConfig(tier: string, isStaked: boolean): QuotaConfig {
    if (isStaked && QUOTA_TIERS['staked'].limit > (QUOTA_TIERS[tier]?.limit ?? 0)) {
      return QUOTA_TIERS['staked'];
    }
    return QUOTA_TIERS[tier] ?? QUOTA_TIERS['basic'];
  }

  private cacheKey(providerId: string, tier: string): string {
    return `${CACHE_PREFIX}${providerId}:${tier}`;
  }

  private resetKey(providerId: string, tier: string): string {
    return `${CACHE_PREFIX}reset:${providerId}:${tier}`;
  }

  private async getResetAt(
    providerId: string,
    tier: string,
    config: QuotaConfig,
  ): Promise<Date> {
    const rKey = this.resetKey(providerId, tier);
    const stored = await this.cache.get<number>(rKey);
    if (stored) return new Date(stored);

    const resetAt = Date.now() + config.windowSeconds * 1000;
    await this.cache.set(rKey, resetAt, config.windowSeconds * 1000);
    return new Date(resetAt);
  }
}
