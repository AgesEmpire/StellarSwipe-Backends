/**
 * IdempotencyInterceptor
 *
 * Protects mutating endpoints (POST/PUT/PATCH/DELETE) against duplicate
 * execution when clients retry after a timeout. Callers opt in by sending an
 * `Idempotency-Key` header:
 *
 *   • The first request for a given (tenant, user, key, route) tuple
 *     executes normally and its response is cached for a configurable TTL
 *     (default 24h — see DEFAULT_TTL_MS).
 *   • Subsequent requests with the same tuple and an identical body return
 *     the cached response without re-running the handler.
 *   • A request that reuses the same key with a different body is rejected
 *     with HTTP 409 Conflict to prevent silent mismatches.
 *   • Concurrent requests with the same cache key are serialised so only one
 *     execution happens; the others await and share its result.
 *   • The tenant ID (from the async-local tenant context — see
 *     ../../tenancy/tenant-context) is part of the cache key so the same
 *     Idempotency-Key value used by two different tenants never collides,
 *     even if both also happen to resolve to the same user ID.
 *
 * Completed responses and request fingerprints are persisted in the configured
 * shared cache; the local map remains a fallback for direct/unit construction.
 */
import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Inject,
  Optional,
  NestInterceptor,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Observable, firstValueFrom, from } from 'rxjs';
import { createHash } from 'crypto';
import { getCurrentTenantIdOrNull } from '../../tenancy/tenant-context';

interface CacheEntry {
  response: unknown;
  bodyHash: string;
  expiresAt: number;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_KEY_LENGTH = 255;

function hashBody(body: unknown): string {
  const normalized =
    body === null || body === undefined ? '' : JSON.stringify(body);
  return createHash('sha256').update(normalized).digest('hex');
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly store = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly cache?: Cache;
  private readonly ttlMs: number;

  constructor(@Optional() @Inject(CACHE_MANAGER) cacheOrTtl?: Cache | number) {
    this.cache = typeof cacheOrTtl === 'object' ? cacheOrTtl : undefined;
    this.ttlMs = typeof cacheOrTtl === 'number' ? cacheOrTtl : DEFAULT_TTL_MS;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const method = String(request?.method ?? '').toUpperCase();

    if (!MUTATING_METHODS.has(method)) {
      return next.handle();
    }

    const rawKey = request?.headers?.['idempotency-key'];
    if (rawKey === undefined || rawKey === null) {
      // Idempotency is opt-in: no key means no de-duplication.
      return next.handle();
    }

    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (
      typeof key !== 'string' ||
      key.trim().length === 0 ||
      key.length > MAX_KEY_LENGTH
    ) {
      throw new BadRequestException('Invalid Idempotency-Key header');
    }

    const route = request?.originalUrl ?? request?.url ?? '';
    const userId: string =
      request?.user?.id ?? request?.user?.walletAddress ?? 'anonymous';
    const tenantId = request?.user?.tenantId ?? getCurrentTenantIdOrNull() ?? 'no-tenant';
    const cacheKey = `${tenantId}:${method}:${route}:${userId}:${key}`;
    const bodyHash = hashBody(request?.body);

    return from(this.resolve(cacheKey, bodyHash, next));
  }

  private async resolve(
    cacheKey: string,
    bodyHash: string,
    next: CallHandler,
  ): Promise<unknown> {
    const cached = this.cache
      ? await this.cache.get<CacheEntry>(cacheKey)
      : this.store.get(cacheKey);
    if (cached) {
      if (cached.expiresAt <= Date.now()) {
        this.cache
          ? await this.cache.del(cacheKey)
          : this.store.delete(cacheKey);
      } else {
        if (cached.bodyHash !== bodyHash) {
          throw new ConflictException(
            'Idempotency-Key reused with a different request payload. ' +
              'Use a new key for a different operation.',
          );
        }
        return cached.response;
      }
    }

    // Serialise concurrent requests with the same cache key.
    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const execution = (async () => {
      const response = await firstValueFrom(next.handle());
      this.store.set(cacheKey, {
        response,
        bodyHash,
        expiresAt: Date.now() + this.ttlMs,
      });
      if (this.cache) {
        await this.cache.set(cacheKey, this.store.get(cacheKey), this.ttlMs);
      }
      return response;
    })();

    this.inFlight.set(cacheKey, execution);
    try {
      return await execution;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }
}
