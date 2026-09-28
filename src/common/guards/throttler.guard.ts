import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';

/**
 * Metadata key used to mark routes as trusted internal traffic.
 * Trusted routes get an explicit, more permissive policy instead of
 * inheriting the public default.
 */
export const TRUSTED_INTERNAL_KEY = 'trusted_internal';

/**
 * Explicit rate-limit policy applied to trusted internal routes.
 * Kept intentionally generous but still bounded so a misbehaving
 * internal caller cannot exhaust the shared store.
 */
export const TRUSTED_INTERNAL_POLICY = {
  limit: 1000,
  ttl: 60_000,
};

/**
 * Distributed throttler guard.
 *
 * Extends the Nest throttler guard so that limits are enforced through the
 * configured shared storage (e.g. Redis) rather than per-instance memory.
 * The storage backend is provided by the ThrottlerModule configuration; this
 * guard only adds response metadata and safe degradation behavior.
 */
@Injectable()
export class DistributedThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(DistributedThrottlerGuard.name);

  constructor(
    options: any,
    storageService: any,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * Resolve the effective limit for the current request.
   * Trusted internal routes use an explicit policy; everything else
   * falls back to the configured public default.
   */
  protected async getLimit(context: ExecutionContext): Promise<number> {
    const isTrusted = this.reflector.getAllAndOverride<boolean>(
      TRUSTED_INTERNAL_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isTrusted) {
      return TRUSTED_INTERNAL_POLICY.limit;
    }

    return super.getLimit(context);
  }

  /**
   * Resolve the effective TTL for the current request.
   */
  protected async getTtl(context: ExecutionContext): Promise<number> {
    const isTrusted = this.reflector.getAllAndOverride<boolean>(
      TRUSTED_INTERNAL_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isTrusted) {
      return TRUSTED_INTERNAL_POLICY.ttl;
    }

    return super.getTtl(context);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    try {
      const allowed = await super.canActivate(context);

      // Attach standard rate-limit metadata headers on success.
      this.setRateLimitHeaders(response, request);

      return allowed;
    } catch (error) {
      if (error instanceof ThrottlerException) {
        // Standard Retry-After header for throttled clients.
        const ttl = await this.getTtl(context);
        response.setHeader('Retry-After', Math.ceil(ttl / 1000));
        this.setRateLimitHeaders(response, request);
        throw error;
      }

      // Store degradation: fail open so a shared-store outage does not
      // take down public and auth-sensitive routes. Log for observability.
      this.logger.error(
        `Rate limit store unavailable, failing open: ${(error as Error)?.message}`,
      );
      return true;
    }
  }

  /**
   * Emit standard rate-limit metadata headers when the underlying
   * throttler exposes tracking information on the request.
   */
  private setRateLimitHeaders(response: Response, request: Request): void {
    const tracker = (request as any).rateLimit;
    if (!tracker) {
      return;
    }

    if (typeof tracker.limit === 'number') {
      response.setHeader('RateLimit-Limit', tracker.limit);
    }
    if (typeof tracker.remaining === 'number') {
      response.setHeader('RateLimit-Remaining', tracker.remaining);
    }
    if (typeof tracker.reset === 'number') {
      response.setHeader('RateLimit-Reset', tracker.reset);
    }
  }
}
