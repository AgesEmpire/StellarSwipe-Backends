import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { RATE_LIMIT_KEY, RateLimitConfig, RateLimitTier } from '../decorators/rate-limit.decorator';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly limits = {
    [RateLimitTier.PUBLIC]: { limit: 100, window: 15 * 60 },
    [RateLimitTier.AUTHENTICATED]: { limit: 1000, window: 15 * 60 },
    [RateLimitTier.TRADE]: { limit: 10, window: 60 },
    [RateLimitTier.SIGNAL]: { limit: 10, window: 24 * 60 * 60 },
    [RateLimitTier.ADMIN]: { limit: 10000, window: 15 * 60 },
  };

  constructor(
    private reflector: Reflector,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.get<RateLimitConfig>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    if (!config) {
      // Default to authenticated tier if no config
      return this.checkRateLimit(context, RateLimitTier.AUTHENTICATED);
    }

    return this.checkRateLimit(context, config.tier, config.limit, config.window);
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
    const finalLimit = customLimit || limit;
    const finalWindow = customWindow || window;

    const key = `rate_limit:${tier}:${identifier}`;
    const info = await this.getRateLimitInfo(key);

    const now = Date.now();
    const windowMs = finalWindow * 1000;

    // Reset if window expired
    if (info.resetTime <= now) {
      info.count = 0;
      info.resetTime = now + windowMs;
    }

    info.count++;

    // Check if limit exceeded
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
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Store updated info
    await this.setRateLimitInfo(key, info, finalWindow);

    // Set rate limit headers
    response.setHeader('X-RateLimit-Limit', finalLimit);
    response.setHeader('X-RateLimit-Remaining', finalLimit - info.count);
    response.setHeader('X-RateLimit-Reset', info.resetTime);

    return true;
  }

  private getIdentifier(request: any, tier: RateLimitTier): string {
    // For authenticated tiers, use user ID
    if (tier !== RateLimitTier.PUBLIC && request.user?.id) {
      return `user:${request.user.id}`;
    }

    // For public, use IP address
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
  }
}