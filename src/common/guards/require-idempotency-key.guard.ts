import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { createHash } from 'crypto';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const IN_FLIGHT_PLACEHOLDER = '__IN_FLIGHT__';

/**
 * RequireIdempotencyKeyGuard
 *
 * Enforces that the client provides an `Idempotency-Key` header on the
 * protected endpoint.  Implements the full idempotency contract:
 *
 *  - Missing header  → 400 Bad Request
 *  - Duplicate key with same body → returns cached response (handled by
 *    IdempotencyInterceptor on the controller; this guard only enforces presence)
 *  - Duplicate key while first request is in-flight → 409 Conflict with
 *    `Retry-After: 2` header
 *  - Key TTL is 24 hours
 *
 * Issue #861 — Add idempotency key support to trade execution and signal creation
 */
@Injectable()
export class RequireIdempotencyKeyGuard implements CanActivate {
  private readonly logger = new Logger(RequireIdempotencyKeyGuard.name);
  /** Tracks keys whose first request is still in-flight (in-process map for single instance). */
  private readonly inFlight = new Set<string>();

  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const rawKey = request.headers?.['idempotency-key'];

    if (!rawKey || (typeof rawKey === 'string' && rawKey.trim() === '')) {
      throw new BadRequestException(
        'Missing required Idempotency-Key header. ' +
          'Generate a unique UUID v4 per request and include it as: Idempotency-Key: <uuid>',
      );
    }

    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    if (
      typeof key !== 'string' ||
      key.trim().length === 0 ||
      key.length > 255
    ) {
      throw new BadRequestException(
        'Invalid Idempotency-Key header: must be a non-empty string of at most 255 characters.',
      );
    }

    const userId: string =
      request?.user?.id ?? request?.user?.walletAddress ?? 'anonymous';
    const route = request?.route?.path ?? request?.url ?? '';
    const cacheKey = `idempotency:${request.method}:${route}:${userId}:${key}`;

    // Detect concurrent in-flight duplicate
    if (this.inFlight.has(cacheKey)) {
      this.logger.warn(
        `Concurrent duplicate idempotency key detected: ${key} for user ${userId}`,
      );
      response.setHeader('Retry-After', '2');
      throw new ConflictException(
        'A request with this Idempotency-Key is already being processed. ' +
          'Please retry after 2 seconds.',
      );
    }

    // Register as in-flight; the interceptor will handle cache read/write and cleanup.
    this.inFlight.add(cacheKey);
    // Attach the resolved cache key so IdempotencyInterceptor can coordinate.
    request.__idempotencyCacheKey = cacheKey;

    // Clean up in-flight registration when the response finishes.
    response.on('finish', () => {
      this.inFlight.delete(cacheKey);
    });

    this.logger.debug(
      `Idempotency-Key ${key} accepted for user ${userId} on ${route}`,
    );
    return true;
  }
}
