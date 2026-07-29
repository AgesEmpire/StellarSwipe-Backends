import { Injectable, Logger, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, of, tap } from 'rxjs';
import { Request, Response } from 'express';
import { CacheService } from './cache.service';

export interface ResponseCacheOptions {
  /** Cache key prefix. Defaults to the request path. */
  keyPrefix?: string;
  /** TTL in seconds. Defaults to 300 (5 min). */
  ttlSeconds?: number;
  /** When true, the cache key includes the authenticated user's ID. */
  perUser?: boolean;
}

const DEFAULT_TTL = 300;
const CACHE_NS = 'stellarswipe:response:';

/**
 * Decorator to mark a controller handler for response-level caching.
 *
 * @example
 * @CacheResponse({ ttlSeconds: 600 })
 * @Get('supported-currencies')
 * getSupportedCurrencies() { ... }
 */
export const RESPONSE_CACHE_KEY = 'responseCacheOptions';

export function CacheResponse(options: ResponseCacheOptions = {}): MethodDecorator {
  return (_target, _key, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(RESPONSE_CACHE_KEY, options, descriptor.value);
    return descriptor;
  };
}

@Injectable()
export class ResponseCacheService {
  private readonly logger = new Logger(ResponseCacheService.name);

  constructor(private readonly cacheService: CacheService) {}

  buildKey(req: Request, options: ResponseCacheOptions, userId?: string): string {
    const base = options.keyPrefix ?? req.path;
    const query = Object.keys(req.query).length
      ? `:${JSON.stringify(req.query)}`
      : '';
    const userSegment = options.perUser && userId ? `:u:${userId}` : '';
    return `${CACHE_NS}${base}${query}${userSegment}`;
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.cacheService.get<T>(key);
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.cacheService.setWithTTL(key, value, ttlSeconds);
    this.logger.debug(`Response cached: ${key} (TTL ${ttlSeconds}s)`);
  }

  async invalidate(keyPrefix: string): Promise<void> {
    await this.cacheService.del(`${CACHE_NS}${keyPrefix}`);
    this.logger.log(`Response cache invalidated: ${keyPrefix}`);
  }
}

/**
 * Interceptor that caches HTTP responses for handlers decorated with @CacheResponse().
 * Authenticated endpoints are supported via perUser option — the user ID is included
 * in the cache key so users never see each other's data.
 */
@Injectable()
export class ResponseCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly responseCacheService: ResponseCacheService,
    private readonly reflector: any,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const options: ResponseCacheOptions | undefined = this.reflector.get(
      RESPONSE_CACHE_KEY,
      context.getHandler(),
    );

    if (!options) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    // Only cache GET requests
    if (req.method !== 'GET') return next.handle();

    const user = (req as any).user;
    const userId = user?.id ?? user?.sub;
    const key = this.responseCacheService.buildKey(req, options, userId);
    const ttl = options.ttlSeconds ?? DEFAULT_TTL;

    return new Observable((observer) => {
      this.responseCacheService.get(key).then((cached) => {
        if (cached !== undefined && cached !== null) {
          observer.next(cached);
          observer.complete();
          return;
        }

        next.handle().pipe(
          tap((response) => {
            this.responseCacheService.set(key, response, ttl).catch(() => {});
          }),
        ).subscribe({
          next: (v) => observer.next(v),
          error: (e) => observer.error(e),
          complete: () => observer.complete(),
        });
      });
    });
  }
}
