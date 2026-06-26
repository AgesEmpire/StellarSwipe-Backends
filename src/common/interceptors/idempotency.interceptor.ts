/**
 * IdempotencyInterceptor
 *
 * Protects mutating endpoints (POST/PUT/PATCH/DELETE) against duplicate
 * execution when clients retry after a timeout. Callers opt in by sending an
 * `Idempotency-Key` header:
 *
 *   • The first request for a given key + route executes normally and its
 *     response is cached for a configurable TTL.
 *   • Subsequent requests with the same key return the cached response without
 *     re-running the handler.
 *   • Concurrent requests with the same key are serialised so only one
 *     execution happens; the others await and share its result.
 *
 * The cache is in-memory and per-instance, which is sufficient for a single
 * process; swap the store for a shared cache (e.g. Redis) for multi-instance
 * deployments.
 */
import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, firstValueFrom, from } from 'rxjs';

interface CacheEntry {
  response: unknown;
  expiresAt: number;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_KEY_LENGTH = 255;

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly store = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly ttlMs: number = DEFAULT_TTL_MS) {}

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
    const cacheKey = `${method}:${route}:${key}`;

    return from(this.resolve(cacheKey, next));
  }

  private async resolve(cacheKey: string, next: CallHandler): Promise<unknown> {
    const cached = this.store.get(cacheKey);
    if (cached) {
      if (cached.expiresAt > Date.now()) {
        return cached.response;
      }
      this.store.delete(cacheKey);
    }

    // Serialise concurrent requests for the same key onto one execution.
    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      return existing;
    }

    const execution = (async () => {
      const response = await firstValueFrom(next.handle());
      this.store.set(cacheKey, {
        response,
        expiresAt: Date.now() + this.ttlMs,
      });
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
