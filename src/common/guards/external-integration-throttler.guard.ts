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

@Injectable()
export class ExternalIntegrationThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(ExternalIntegrationThrottlerGuard.name);

  protected async throwThrottlingException(
    context: ExecutionContext,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest();
    const identifier = this.getIdentifier(request);

    this.logger.warn(
      `External integration rate limit exceeded: identifier=${identifier} path=${request.url}`,
      {
        type: 'external_rate_limit_exceeded',
        identifier,
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    );

    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Rate limit exceeded for external integration endpoint',
        retryAfter: 60,
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
