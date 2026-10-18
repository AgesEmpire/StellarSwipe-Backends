/**
 * ExternalIntegrationThrottlerGuard
 *
 * Redis-backed rate limiting guard for external-facing integration endpoints
 * (api-keys, currency, price feeds, etc.).
 *
 * Limits are configurable via environment variables:
 *   EXTERNAL_RATE_LIMIT_TTL   – window in seconds  (default: 60)
 *   EXTERNAL_RATE_LIMIT_MAX   – max requests/window (default: 30)
 *
 * Resolves: #453 – Add backend API rate limiting for external integrations
 */
import {
  Injectable,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { setRateLimitHeaders } from '../rate-limit/rate-limit-headers.util';

@Injectable()
export class ExternalIntegrationThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(ExternalIntegrationThrottlerGuard.name);

  // #1380 — this guard previously threw a 429 without setting any
  // rate-limit headers, unlike RateLimitGuard/RateLimitMiddleware/
  // DistributedThrottlerGuard. Resolve the configured limit/ttl the same
  // way DistributedThrottlerGuard does (via the base ThrottlerGuard's
  // getLimit/getTtl) so external-integration responses carry the same
  // X-RateLimit-*/Retry-After headers as every other throttled route.
  protected async throwThrottlingException(
    context: ExecutionContext,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const identifier = this.getIdentifier(request);

    const [limit, ttl] = await Promise.all([
      this.getLimit(context),
      this.getTtl(context),
    ]);
    const retryAfter = Math.ceil(ttl / 1000);

    this.logger.warn(
      `External integration rate limit exceeded: identifier=${identifier} path=${request.url}`,
      {
        type: 'external_rate_limit_exceeded',
        identifier,
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    );

    setRateLimitHeaders(response, {
      limit,
      remaining: 0,
      retryAfter,
    });

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Rate limit exceeded for external integration endpoint',
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Use API key header if present, otherwise fall back to IP. */
  protected getIdentifier(request: any): string {
    const apiKey =
      request.headers['x-api-key'] ||
      request.headers['authorization']?.replace('Bearer ', '');
    if (apiKey) return `apikey:${apiKey.slice(0, 8)}`;

    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) return `ip:${forwarded.split(',')[0].trim()}`;
    return `ip:${request.socket?.remoteAddress ?? 'unknown'}`;
  }
}
