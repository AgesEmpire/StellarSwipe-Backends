import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import { RATE_LIMIT_KEY, RateLimitConfig, RateLimitTier } from '../decorators/rate-limit.decorator';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

// Default per-IP limit/window (seconds) per tier.
// Override via RATE_LIMIT_<TIER>_LIMIT / RATE_LIMIT_<TIER>_WINDOW env vars.
const DEFAULT_TIER_LIMITS: Record<RateLimitTier, { limit: number; window: number }> = {
  [RateLimitTier.PUBLIC]: { limit: 100, window: 15 * 60 },
  [RateLimitTier.AUTH]: { limit: 10, window: 60 },
  [RateLimitTier.AUTHENTICATED]: { limit: 1000, window: 15 * 60 },
  [RateLimitTier.TRADE]: { limit: 10, window: 60 },
  [RateLimitTier.SIGNAL]: { limit: 10, window: 24 * 60 * 60 },
  [RateLimitTier.ADMIN]: { limit: 10000, window: 15 * 60 },
};

// Default per-account limit/window (seconds) per tier, used when keyBy is set.
// Override via RATE_LIMIT_<TIER>_ACCOUNT_LIMIT / RATE_LIMIT_<TIER>_ACCOUNT_WINDOW env vars.
const DEFAULT_ACCOUNT_TIER_LIMITS: Record<RateLimitTier, { limit: number; window: number }> = {
  [RateLimitTier.PUBLIC]: { limit: 50, window: 15 * 60 },
  [RateLimitTier.AUTH]: { limit: 5, window: 300 },
  [RateLimitTier.AUTHENTICATED]: { limit: 500, window: 15 * 60 },
  [RateLimitTier.TRADE]: { limit: 5, window: 60 },
  [RateLimitTier.SIGNAL]: { limit: 5, window: 24 * 60 * 60 },
  [RateLimitTier.ADMIN]: { limit: 5000, window: 15 * 60 },
};

// Default per-wallet limit/window (seconds) per tier.
// Override via RATE_LIMIT_<TIER>_WALLET_LIMIT / RATE_LIMIT_<TIER>_WALLET_WINDOW env vars.
const DEFAULT_WALLET_TIER_LIMITS: Record<RateLimitTier, { limit: number; window: number }> = {
  [RateLimitTier.PUBLIC]: { limit: 60, window: 15 * 60 },
  [RateLimitTier.AUTH]: { limit: 8, window: 300 },
  [RateLimitTier.AUTHENTICATED]: { limit: 600, window: 15 * 60 },
  [RateLimitTier.TRADE]: { limit: 8, window: 60 },
  [RateLimitTier.SIGNAL]: { limit: 8, window: 24 * 60 * 60 },
  [RateLimitTier.ADMIN]: { limit: 6000, window: 15 * 60 },
};

// Violation count thresholds for abuse pattern escalation within a 1-hour window.
const ABUSE_WARN_THRESHOLD = 3;
const ABUSE_ERROR_THRESHOLD = 10;
const ABUSE_TRACKING_WINDOW_S = 3600;

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly limits: Record<RateLimitTier, { limit: number; window: number }>;
  private readonly accountLimits: Record<RateLimitTier, { limit: number; window: number }>;
  private readonly walletLimits: Record<RateLimitTier, { limit: number; window: number }>;

  constructor(
    private reflector: Reflector,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Optional() private configService?: ConfigService,
    @Optional() private subscriptionsService?: SubscriptionsService,
  ) {
    this.limits = this.buildTierLimits();
    this.accountLimits = this.buildAccountTierLimits();
    this.walletLimits = this.buildWalletTierLimits();
  }

  private buildTierLimits(): Record<RateLimitTier, { limit: number; window: number }> {
    const tiers = Object.values(RateLimitTier) as RateLimitTier[];
    return tiers.reduce((acc, tier) => {
      const envPrefix = `RATE_LIMIT_${tier.toUpperCase()}`;
      const defaults = DEFAULT_TIER_LIMITS[tier];
      acc[tier] = {
        limit: this.getEnvNumber(`${envPrefix}_LIMIT`, defaults.limit),
        window: this.getEnvNumber(`${envPrefix}_WINDOW`, defaults.window),
      };
      return acc;
    }, {} as Record<RateLimitTier, { limit: number; window: number }>);
  }

  private buildAccountTierLimits(): Record<RateLimitTier, { limit: number; window: number }> {
    const tiers = Object.values(RateLimitTier) as RateLimitTier[];
    return tiers.reduce((acc, tier) => {
      const envPrefix = `RATE_LIMIT_${tier.toUpperCase()}_ACCOUNT`;
      const defaults = DEFAULT_ACCOUNT_TIER_LIMITS[tier];
      acc[tier] = {
        limit: this.getEnvNumber(`${envPrefix}_LIMIT`, defaults.limit),
        window: this.getEnvNumber(`${envPrefix}_WINDOW`, defaults.window),
      };
      return acc;
    }, {} as Record<RateLimitTier, { limit: number; window: number }>);
  }

  private buildWalletTierLimits(): Record<RateLimitTier, { limit: number; window: number }> {
    const tiers = Object.values(RateLimitTier) as RateLimitTier[];
    return tiers.reduce((acc, tier) => {
      const envPrefix = `RATE_LIMIT_${tier.toUpperCase()}_WALLET`;
      const defaults = DEFAULT_WALLET_TIER_LIMITS[tier];
      acc[tier] = {
        limit: this.getEnvNumber(`${envPrefix}_LIMIT`, defaults.limit),
        window: this.getEnvNumber(`${envPrefix}_WINDOW`, defaults.window),
      };
      return acc;
    }, {} as Record<RateLimitTier, { limit: number; window: number }>);
  }

  private getEnvNumber(key: string, fallback: number): number {
    const raw = this.configService?.get<string | number>(key);
    const parsed = Number(raw);
    return raw !== undefined && raw !== null && !Number.isNaN(parsed) ? parsed : fallback;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.get<RateLimitConfig>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    const resolvedTier = await this.resolveUserTier(context);
    const effectiveTier = config?.tier || resolvedTier;

    // Per-IP check
    await this.checkRateLimit(context, effectiveTier, config?.limit, config?.window);

    // Per-wallet check when the request has an authenticated wallet address
    const walletAddress = this.extractWalletAddress(context);
    if (walletAddress) {
      await this.checkWalletLimit(
        context,
        effectiveTier,
        walletAddress,
        config?.walletLimit,
        config?.walletWindow,
      );
    }

    // Per-account check when keyBy is specified
    if (config?.keyBy?.length) {
      const request = context.switchToHttp().getRequest();
      const accountId = this.extractAccountIdentifier(request, config.keyBy);
      if (accountId) {
        await this.checkAccountLimit(
          context,
          effectiveTier,
          accountId,
          config.accountLimit,
          config.accountWindow,
        );
      }
    }

    return true;
  }

  private async resolveUserTier(context: ExecutionContext): Promise<RateLimitTier> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId || !this.subscriptionsService) {
      return RateLimitTier.AUTHENTICATED;
    }

    try {
      const subscriptions = await this.subscriptionsService.getUserSubscriptions(userId);
      const activeSubscription = subscriptions.find(sub => sub.status === 'ACTIVE');

      if (activeSubscription) {
        const tier = activeSubscription.tier;
        if (tier?.level === 'PREMIUM' || tier?.level === 'PROVIDER') {
          return RateLimitTier.ADMIN;
        }
      }

      return RateLimitTier.AUTHENTICATED;
    } catch {
      return RateLimitTier.AUTHENTICATED;
    }
  }

  private async checkRateLimit(
    context: ExecutionContext,
    tier: RateLimitTier,
    customLimit?: number,
    customWindow?: number,
  ): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const identifier = this.getIdentifier(request, tier);
    const { limit, window } = this.limits[tier];
    const finalLimit = customLimit ?? limit;
    const finalWindow = customWindow ?? window;

    const key = `rate_limit:${tier}:${identifier}`;
    const info = await this.getRateLimitInfo(key);

    const now = Date.now();
    const windowMs = finalWindow * 1000;

    if (info.resetTime <= now) {
      info.count = 0;
      info.resetTime = now + windowMs;
    }

    info.count++;

    if (info.count > finalLimit) {
      const retryAfter = Math.ceil((info.resetTime - now) / 1000);

      response.setHeader('X-RateLimit-Limit', finalLimit);
      response.setHeader('X-RateLimit-Remaining', 0);
      response.setHeader('X-RateLimit-Reset', info.resetTime);
      response.setHeader('Retry-After', retryAfter);

      this.logViolation(identifier, tier, finalLimit);

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests',
          error: 'Too Many Requests',
          retryAfter,
          guidance: `Rate limit of ${finalLimit} requests per ${finalWindow}s exceeded. Retry after ${retryAfter}s or once the X-RateLimit-Reset timestamp has passed.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.setRateLimitInfo(key, info, finalWindow);

    response.setHeader('X-RateLimit-Limit', finalLimit);
    response.setHeader('X-RateLimit-Remaining', finalLimit - info.count);
    response.setHeader('X-RateLimit-Reset', info.resetTime);

    return true;
  }

  private async checkAccountLimit(
    context: ExecutionContext,
    tier: RateLimitTier,
    accountId: string,
    customLimit?: number,
    customWindow?: number,
  ): Promise<void> {
    const response = context.switchToHttp().getResponse();
    const { limit: defaultLimit, window: defaultWindow } = this.accountLimits[tier];
    const finalLimit = customLimit ?? defaultLimit;
    const finalWindow = customWindow ?? defaultWindow;

    const key = `rate_limit:account:${tier}:${accountId}`;
    const info = await this.getRateLimitInfo(key);

    const now = Date.now();
    const windowMs = finalWindow * 1000;

    if (info.resetTime <= now) {
      info.count = 0;
      info.resetTime = now + windowMs;
    }

    info.count++;

    if (info.count > finalLimit) {
      const retryAfter = Math.ceil((info.resetTime - now) / 1000);

      response.setHeader('X-RateLimit-Limit', finalLimit);
      response.setHeader('X-RateLimit-Remaining', 0);
      response.setHeader('X-RateLimit-Reset', info.resetTime);
      response.setHeader('Retry-After', retryAfter);

      this.logViolation(accountId, tier, finalLimit);

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests',
          error: 'Too Many Requests',
          retryAfter,
          guidance: `Rate limit of ${finalLimit} requests per ${finalWindow}s exceeded. Retry after ${retryAfter}s or once the X-RateLimit-Reset timestamp has passed.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.setRateLimitInfo(key, info, finalWindow);

    response.setHeader('X-RateLimit-Limit', finalLimit);
    response.setHeader('X-RateLimit-Remaining', finalLimit - info.count);
    response.setHeader('X-RateLimit-Reset', info.resetTime);
  }

  private extractWalletAddress(context: ExecutionContext): string | null {
    const request = context.switchToHttp().getRequest();
    const wallet = request.user?.walletAddress ?? request.user?.wallet ?? null;
    return typeof wallet === 'string' && wallet.length > 0 ? wallet.toLowerCase() : null;
  }

  private async checkWalletLimit(
    context: ExecutionContext,
    tier: RateLimitTier,
    walletAddress: string,
    customLimit?: number,
    customWindow?: number,
  ): Promise<void> {
    const response = context.switchToHttp().getResponse();
    const { limit: defaultLimit, window: defaultWindow } = this.walletLimits[tier];
    const finalLimit = customLimit ?? defaultLimit;
    const finalWindow = customWindow ?? defaultWindow;

    const key = `rate_limit:wallet:${tier}:${walletAddress}`;
    const info = await this.getRateLimitInfo(key);

    const now = Date.now();
    const windowMs = finalWindow * 1000;

    if (info.resetTime <= now) {
      info.count = 0;
      info.resetTime = now + windowMs;
    }

    info.count++;

    if (info.count > finalLimit) {
      const retryAfter = Math.ceil((info.resetTime - now) / 1000);

      response.setHeader('X-RateLimit-Limit', finalLimit);
      response.setHeader('X-RateLimit-Remaining', 0);
      response.setHeader('X-RateLimit-Reset', info.resetTime);
      response.setHeader('Retry-After', retryAfter);

      this.logViolation(`wallet:${walletAddress}`, tier, finalLimit);

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'Too many requests',
          error: 'Too Many Requests',
          retryAfter,
          guidance: `Wallet rate limit of ${finalLimit} requests per ${finalWindow}s exceeded. Retry after ${retryAfter}s.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.setRateLimitInfo(key, info, finalWindow);
  }

  private extractAccountIdentifier(request: any, keyBy: string[]): string | null {
    const body = request.body ?? {};
    const parts = keyBy
      .map(field => body[field])
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map(v => v.toLowerCase().trim());
    return parts.length > 0 ? parts.join(':') : null;
  }

  private getIdentifier(request: any, tier: RateLimitTier): string {
    if (tier !== RateLimitTier.PUBLIC && tier !== RateLimitTier.AUTH && request.user?.id) {
      return `user:${request.user.id}`;
    }
    const ip = this.getClientIP(request);
    return `ip:${ip}`;
  }

  private getClientIP(request: any): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return request.headers['x-real-ip'] || request.socket.remoteAddress || '127.0.0.1';
  }

  private async getRateLimitInfo(key: string): Promise<RateLimitInfo> {
    const cached = await this.cacheManager.get<RateLimitInfo>(key);
    if (cached) {
      return cached;
    }
    return { count: 0, resetTime: Date.now() };
  }

  private async setRateLimitInfo(
    key: string,
    info: RateLimitInfo,
    ttl: number,
  ): Promise<void> {
    await this.cacheManager.set(key, info, ttl * 1000);
  }

  private logViolation(identifier: string, tier: RateLimitTier, limit: number): void {
    this.logger.warn(
      `Rate limit exceeded: identifier=${identifier} tier=${tier} limit=${limit}`,
      { type: 'rate_limit_violation', identifier, tier, limit, timestamp: new Date().toISOString() },
    );
    this.trackAbuseViolation(identifier, tier);
  }

  // Tracks cumulative violations in a rolling 1-hour window and escalates log severity
  // when repeat abuse is detected. Fire-and-forget — does not block the response.
  private trackAbuseViolation(identifier: string, tier: RateLimitTier): void {
    const abuseKey = `rate_limit_abuse:${tier}:${identifier}`;
    this.cacheManager
      .get<number>(abuseKey)
      .then(count => {
        const violations = (count ?? 0) + 1;
        this.cacheManager.set(abuseKey, violations, ABUSE_TRACKING_WINDOW_S * 1000);

        if (violations >= ABUSE_ERROR_THRESHOLD) {
          this.logger.error(
            `Persistent abuse detected: identifier=${identifier} tier=${tier} violations=${violations} in 1h`,
            { type: 'persistent_abuse', identifier, tier, violations, timestamp: new Date().toISOString() },
          );
        } else if (violations >= ABUSE_WARN_THRESHOLD) {
          this.logger.warn(
            `Abuse pattern detected: identifier=${identifier} tier=${tier} violations=${violations} in 1h`,
            { type: 'abuse_pattern_detected', identifier, tier, violations, timestamp: new Date().toISOString() },
          );
        }
      })
      .catch(() => {
        // Abuse tracking is best-effort; don't surface cache failures
      });
  }
}
