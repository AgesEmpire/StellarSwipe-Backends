import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { PrometheusService } from '../monitoring/metrics/prometheus.service';

export enum CachePrefix {
    SESSION = 'stellarswipe:session:',
    SIGNAL = 'stellarswipe:signal:',
    PORTFOLIO = 'stellarswipe:portfolio:',
    SDEX = 'stellarswipe:sdex:',
    ANALYTICS = 'stellarswipe:analytics:',
    USER_PROFILE = 'stellarswipe:user:',
    MARKET = 'stellarswipe:market:',
}

/** Build a tenant-namespaced cache key: <prefix><tenantId>:<entityId> */
export function tenantKey(prefix: CachePrefix, tenantId: string, entityId: string): string {
    return `${prefix}${tenantId}:${entityId}`;
}

export type CacheTTLType = 'session' | 'signal' | 'portfolio' | 'default';

@Injectable()
export class CacheService {
    private readonly logger = new Logger(CacheService.name);
    private readonly ttlConfig: Record<CacheTTLType, number>;

    constructor(
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
        private readonly configService: ConfigService,
        @Optional() private readonly prometheusService?: PrometheusService,
    ) {
        this.ttlConfig = {
            session: this.configService.get<number>('redisCache.ttl.session') ?? 24 * 60 * 60,
            signal: this.configService.get<number>('redisCache.ttl.signal') ?? 30,
            portfolio: this.configService.get<number>('redisCache.ttl.portfolio') ?? 5 * 60,
            default: this.configService.get<number>('redisCache.ttl.default') ?? 60,
        };
    }

    /**
     * Get a value from cache
     */
    async get<T>(key: string): Promise<T | undefined> {
        try {
            const value = await this.cacheManager.get<T>(key);
            if (value !== undefined && value !== null) {
                this.prometheusService?.cacheHitsTotal.inc({ layer: 'redis' });
            } else {
                this.prometheusService?.cacheMissesTotal.inc({ layer: 'redis' });
            }
            return value;
        } catch (error) {
            this.logger.error(`Cache GET error for key ${key}:`, error);
            return undefined;
        }
    }

    /**
     * Set a value in cache with TTL
     */
    async set<T>(key: string, value: T, ttlType: CacheTTLType = 'default'): Promise<void> {
        try {
            const ttl = this.ttlConfig[ttlType];
            await this.cacheManager.set(key, value, ttl * 1000); // cache-manager expects ms
        } catch (error) {
            this.logger.error(`Cache SET error for key ${key}:`, error);
        }
    }

    /**
     * Set a value with custom TTL in seconds
     */
    async setWithTTL<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
        try {
            await this.cacheManager.set(key, value, ttlSeconds * 1000);
        } catch (error) {
            this.logger.error(`Cache SET error for key ${key}:`, error);
        }
    }

    /**
     * Delete a key from cache (invalidation)
     */
    async del(key: string): Promise<void> {
        try {
            await this.cacheManager.del(key);
        } catch (error) {
            this.logger.error(`Cache DEL error for key ${key}:`, error);
        }
    }

    /**
     * Invalidate all keys matching a prefix pattern
     */
    async invalidateByPrefix(prefix: CachePrefix): Promise<void> {
        try {
            // Note: Pattern-based deletion requires Redis store implementation
            // This is a placeholder for cache invalidation strategy
            this.logger.log(`Cache invalidation requested for prefix: ${prefix}`);
        } catch (error) {
            this.logger.error(`Cache invalidation error for prefix ${prefix}:`, error);
        }
    }

    /**
     * Session-specific cache operations
     */
    async getSession<T>(sessionId: string): Promise<T | undefined> {
        return this.get<T>(`${CachePrefix.SESSION}${sessionId}`);
    }

    async setSession<T>(sessionId: string, data: T): Promise<void> {
        await this.set(`${CachePrefix.SESSION}${sessionId}`, data, 'session');
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.del(`${CachePrefix.SESSION}${sessionId}`);
    }

    /**
     * Signal feed cache operations
     */
    async getSignal<T>(signalKey: string): Promise<T | undefined> {
        return this.get<T>(`${CachePrefix.SIGNAL}${signalKey}`);
    }

    async setSignal<T>(signalKey: string, data: T): Promise<void> {
        await this.set(`${CachePrefix.SIGNAL}${signalKey}`, data, 'signal');
    }

    async deleteSignal(signalKey: string): Promise<void> {
        await this.del(`${CachePrefix.SIGNAL}${signalKey}`);
    }

    /**
     * Portfolio cache operations
     */
    async getPortfolio<T>(userId: string): Promise<T | undefined> {
        return this.get<T>(`${CachePrefix.PORTFOLIO}${userId}`);
    }

    async setPortfolio<T>(userId: string, data: T): Promise<void> {
        await this.set(`${CachePrefix.PORTFOLIO}${userId}`, data, 'portfolio');
    }

    async deletePortfolio(userId: string): Promise<void> {
        await this.del(`${CachePrefix.PORTFOLIO}${userId}`);
    }

    /**
     * Cache-aside: return cached value or fetch, cache, and return.
     * Prevents duplicate DB reads for repeated identical requests.
     */
    async getOrSet<T>(
        key: string,
        fetchFn: () => Promise<T>,
        ttlType: CacheTTLType = 'default',
    ): Promise<T> {
        const cached = await this.get<T>(key);
        if (cached !== undefined && cached !== null) {
            return cached;
        }
        const value = await fetchFn();
        await this.set(key, value, ttlType);
        return value;
    }

    /**
     * Stampede-safe getOrSet: coalesces concurrent fetches for the same key
     * into a single DB/upstream call.
     */
    private readonly inflightRequests = new Map<string, Promise<any>>();
    private readonly inflightXFetchRequests = new Map<string, Promise<XFetchEntry<any>>>();

    async getOrSetWithLock<T>(
        key: string,
        fetchFn: () => Promise<T>,
        ttlType: CacheTTLType = 'default',
    ): Promise<T> {
        const cached = await this.get<T>(key);
        if (cached !== undefined && cached !== null) {
            return cached;
        }

        if (this.inflightRequests.has(key)) {
            return this.inflightRequests.get(key) as Promise<T>;
        }

        const promise = fetchFn().then(async (value) => {
            await this.set(key, value, ttlType);
            return value;
        }).finally(() => {
            this.inflightRequests.delete(key);
        });

        this.inflightRequests.set(key, promise);
        return promise;
    }

    getTTL(ttlType: CacheTTLType): number {
        return this.ttlConfig[ttlType];
    }

    /**
     * Stampede-safe getOrSet using Probabilistic Early Recomputation (XFetch).
     *
     * Instead of waiting for hard TTL expiry — where every concurrent
     * requester finds a simultaneous miss and stampedes the DB — each read
     * near expiry has a probability of triggering a recompute early. That
     * probability rises as the entry approaches expiry and scales with how
     * expensive the last recompute was, so a smooth stream of early
     * refreshes replaces one big thundering-herd spike. Unlike
     * `getOrSetWithLock`, other concurrent readers are never blocked on the
     * recompute — they keep getting the still-valid cached value while one
     * winner refreshes it in the background.
     *
     * recompute if: now - (delta * beta * ln(random())) > expiry
     * (Vattani, Chierichetti & Lowenstein, "Optimal Probabilistic Cache Stampede Prevention", 2015)
     */
    async fetchWithEarlyRecomputation<T>(
        key: string,
        ttlSeconds: number,
        computeFn: () => Promise<T>,
        beta = 1,
    ): Promise<T> {
        // `get()` already records the hit/miss metric for this lookup.
        const entry = await this.get<XFetchEntry<T>>(key);
        const now = Date.now();

        if (entry !== undefined && entry !== null) {
            const xfetch = entry.delta * beta * Math.log(Math.random());
            if (now - xfetch < entry.expiry) {
                // Still fresh and the probabilistic check didn't fire — serve as-is.
                return entry.value;
            }

            this.prometheusService?.cacheEarlyRecomputeTotal.inc({ layer: 'redis' });
            // Recompute in the background; concurrent/subsequent readers keep
            // getting the still-valid cached value until it lands, so nobody
            // blocks and only one recompute runs per key.
            this.recomputeInBackground(key, ttlSeconds, computeFn, beta);
            return entry.value;
        }

        // Hard miss — coalesce concurrent callers into a single computeFn call.
        return this.getOrSetXFetchEntry(key, ttlSeconds, computeFn, beta);
    }

    private recomputeInBackground<T>(
        key: string,
        ttlSeconds: number,
        computeFn: () => Promise<T>,
        beta: number,
    ): void {
        if (this.inflightXFetchRequests.has(key)) {
            // A refresh for this key is already in flight.
            return;
        }
        void this.getOrSetXFetchEntry(key, ttlSeconds, computeFn, beta).catch((error) => {
            this.logger.error(`XFetch background recompute failed for key ${key}:`, error);
        });
    }

    private async getOrSetXFetchEntry<T>(
        key: string,
        ttlSeconds: number,
        computeFn: () => Promise<T>,
        beta: number,
    ): Promise<T> {
        const existingFlight = this.inflightXFetchRequests.get(key);
        if (existingFlight) {
            return existingFlight.then((entry) => entry.value);
        }

        const promise = (async (): Promise<XFetchEntry<T>> => {
            const start = Date.now();
            const value = await computeFn();
            const delta = Math.max(Date.now() - start, 1);
            const entry: XFetchEntry<T> = { value, delta, expiry: Date.now() + ttlSeconds * 1000, beta };
            await this.setWithTTL(key, entry, ttlSeconds);
            return entry;
        })().finally(() => {
            this.inflightXFetchRequests.delete(key);
        });

        this.inflightXFetchRequests.set(key, promise);
        return promise.then((entry) => entry.value);
    }
}

interface XFetchEntry<T> {
    value: T;
    /** Duration the last recompute took, in ms — drives recompute urgency. */
    delta: number;
    /** Absolute expiry time (epoch ms) of this entry. */
    expiry: number;
    beta: number;
}
