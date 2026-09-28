import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import {
  ApiKeyTier,
  ApiKeyTierLimits,
  API_KEY_TIER_LIMITS,
  EndpointGroup,
  ENDPOINT_GROUP_PATTERNS,
} from './rate-limit-config';

export interface ApiKeyRateLimitInfo {
  count: number;
  resetTime: number;
  isBurst: boolean;
}

export interface ApiKeyRateLimitResult {
  allowed: boolean;
  current: number;
  limit: number;
  retryAfter: number;
  burstApplied: boolean;
}

/**
 * ApiKeyRateLimitService
 *
 * Provides API key-scoped rate limiting with tier-based limits and burst support.
 * Uses Redis-backed caching for distributed rate limit state.
 */
@Injectable()
export class ApiKeyRateLimitService {
  private readonly logger = new Logger(ApiKeyRateLimitService.name);
  private readonly tierLimits: Record<string, ApiKeyTierLimits>;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {
    this.tierLimits = this.loadTierLimits();
  }

  async checkRateLimit(
    apiKeyHash: string,
    tier: ApiKeyTier,
    endpointPath: string,
    tenantId?: string,
  ): Promise<ApiKeyRateLimitResult> {
    const endpointGroup = this.resolveEndpointGroup(endpointPath);
    const limits = this.tierLimits[tier] ?? this.tierLimits[ApiKeyTier.FREE];

    // Try burst window first
    const burstResult = await this.checkWindow(
      this.burstKey(apiKeyHash, endpointGroup, tenantId),
      limits.burstLimit,
      limits.burstWindowSeconds,
    );

    if (burstResult.allowed) {
      return { ...burstResult, limit: limits.burstLimit, burstApplied: true };
    }

    // Fall back to standard window
    const standardResult = await this.checkWindow(
      this.standardKey(apiKeyHash, endpointGroup, tenantId),
      limits.limit,
      limits.windowSeconds,
    );

    return { ...standardResult, limit: limits.limit, burstApplied: false };
  }

  async getRateLimitHeaders(
    apiKeyHash: string,
    tier: ApiKeyTier,
    endpointPath: string,
    tenantId?: string,
  ): Promise<Record<string, string>> {
    const limits = this.tierLimits[tier] ?? this.tierLimits[ApiKeyTier.FREE];
    const endpointGroup = this.resolveEndpointGroup(endpointPath);

    const standardInfo = await this.getWindowInfo(this.standardKey(apiKeyHash, endpointGroup, tenantId));
    const burstInfo = await this.getWindowInfo(this.burstKey(apiKeyHash, endpointGroup, tenantId));

    const headers: Record<string, string> = {
      'X-RateLimit-Limit': String(limits.limit),
      'X-RateLimit-Remaining': String(Math.max(0, limits.limit - standardInfo.count)),
      'X-RateLimit-Reset': String(Math.ceil(standardInfo.resetTime / 1000)),
      'X-RateLimit-Burst-Limit': String(limits.burstLimit),
      'X-RateLimit-Burst-Remaining': String(Math.max(0, limits.burstLimit - burstInfo.count)),
      'X-RateLimit-Tier': tier,
    };
    if (tenantId) {
      headers['X-RateLimit-Tenant'] = tenantId;
    }
    return headers;
  }

  resolveEndpointGroup(path: string): EndpointGroup {
    for (const [group, patterns] of Object.entries(ENDPOINT_GROUP_PATTERNS)) {
      if (patterns.some((pattern) => pattern.test(path))) {
        return group as EndpointGroup;
      }
    }
    return EndpointGroup.DEFAULT;
  }

  resolveTier(apiKeyRateLimit: number): ApiKeyTier {
    if (apiKeyRateLimit >= 20000) return ApiKeyTier.ENTERPRISE;
    if (apiKeyRateLimit >= 5000) return ApiKeyTier.BUSINESS;
    if (apiKeyRateLimit >= 1000) return ApiKeyTier.STARTER;
    return ApiKeyTier.FREE;
  }

  private async checkWindow(
    key: string,
    maxLimit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; current: number; retryAfter: number }> {
    const info = await this.getWindowInfo(key);
    const now = Date.now();

    if (info.resetTime <= now) {
      const newResetTime = now + windowSeconds * 1000;
      await this.cacheManager.set(key, { count: 1, resetTime: newResetTime }, windowSeconds * 1000);
      return { allowed: true, current: 1, retryAfter: windowSeconds };
    }

    if (info.count >= maxLimit) {
      const retryAfter = Math.ceil((info.resetTime - now) / 1000);
      return { allowed: false, current: info.count, retryAfter };
    }

    const newCount = info.count + 1;
    await this.cacheManager.set(key, { count: newCount, resetTime: info.resetTime }, windowSeconds * 1000);
    const retryAfter = Math.ceil((info.resetTime - now) / 1000);
    return { allowed: true, current: newCount, retryAfter };
  }

  private async getWindowInfo(key: string): Promise<ApiKeyRateLimitInfo> {
    const cached = await this.cacheManager.get<ApiKeyRateLimitInfo>(key);
    if (cached) return cached;
    return { count: 0, resetTime: Date.now(), isBurst: false };
  }

  private standardKey(apiKeyHash: string, group: EndpointGroup, tenantId?: string): string {
    const prefix = tenantId ? `tenant:${tenantId}:` : '';
    return `rate_limit:${prefix}api_key:${group}:${apiKeyHash}`;
  }

  private burstKey(apiKeyHash: string, group: EndpointGroup, tenantId?: string): string {
    const prefix = tenantId ? `tenant:${tenantId}:` : '';
    return `rate_limit:${prefix}api_key:burst:${group}:${apiKeyHash}`;
  }

  private loadTierLimits(): Record<string, ApiKeyTierLimits> {
    const loaded: Record<string, ApiKeyTierLimits> = {};
    for (const [tier, defaultLimits] of Object.entries(API_KEY_TIER_LIMITS)) {
      loaded[tier] = {
        limit: this.configService.get<number>(`API_KEY_RATE_LIMIT_${tier.toUpperCase()}_LIMIT`) ?? defaultLimits.limit,
        burstLimit: this.configService.get<number>(`API_KEY_RATE_LIMIT_${tier.toUpperCase()}_BURST`) ?? defaultLimits.burstLimit,
        windowSeconds: this.configService.get<number>(`API_KEY_RATE_LIMIT_${tier.toUpperCase()}_WINDOW`) ?? defaultLimits.windowSeconds,
        burstWindowSeconds: this.configService.get<number>(`API_KEY_RATE_LIMIT_${tier.toUpperCase()}_BURST_WINDOW`) ?? defaultLimits.burstWindowSeconds,
      };
    }
    return loaded;
  }
}
