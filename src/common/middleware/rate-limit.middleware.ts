import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { setRateLimitHeaders } from '../rate-limit/rate-limit-headers.util';

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private readonly GLOBAL_LIMIT = 100;
  private readonly GLOBAL_WINDOW = 15 * 60; // 15 minutes

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const ip = this.getClientIP(req);
    const key = `global_rate_limit:${ip}`;

    try {
      const info = await this.getRateLimitInfo(key);
      const now = Date.now();
      const windowMs = this.GLOBAL_WINDOW * 1000;

      // Reset if window expired
      if (info.resetTime <= now) {
        info.count = 0;
        info.resetTime = now + windowMs;
      }

      info.count++;

      // Check if limit exceeded
      if (info.count > this.GLOBAL_LIMIT) {
        const retryAfter = Math.ceil((info.resetTime - now) / 1000);

        setRateLimitHeaders(res, {
          limit: this.GLOBAL_LIMIT,
          remaining: 0,
          reset: info.resetTime,
          retryAfter,
        });

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: 'Too many requests from this IP',
            retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // Store updated info
      await this.setRateLimitInfo(key, info);

      // Set headers
      setRateLimitHeaders(res, {
        limit: this.GLOBAL_LIMIT,
        remaining: this.GLOBAL_LIMIT - info.count,
        reset: info.resetTime,
      });

      next();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      next();
    }
  }

  private getClientIP(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return (forwarded as string).split(',')[0].trim();
    }
    return (req.headers['x-real-ip'] as string) || req.socket.remoteAddress || '127.0.0.1';
  }

  private async getRateLimitInfo(key: string): Promise<{ count: number; resetTime: number }> {
    const cached = await this.cacheManager.get<{ count: number; resetTime: number }>(key);
    if (cached) {
      return cached;
    }
    return { count: 0, resetTime: Date.now() };
  }

  private async setRateLimitInfo(key: string, info: { count: number; resetTime: number }): Promise<void> {
    await this.cacheManager.set(key, info, this.GLOBAL_WINDOW * 1000);
  }
}