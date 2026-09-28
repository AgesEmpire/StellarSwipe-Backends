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
     * into a single DB/upstream call. Loader failures are never cached.
     */
    private readonly inflightRequests = new Map<string, Promise<any>>();
    private readonly stampedeMetrics = {
        loads: 0,
        coalesced: 0,
        staleServed: 0,
        loaderFailures: 0,
        lockContention: 0,
    };

    getStampedeMetrics(): Readonly<typeof this.stampedeMetrics> {
        return { ...this.stampedeMetrics };
    }

    async getOrSetWithLock<T>(
        key: string,
        fetchFn: () => Promise<T>,
        ttlType: CacheTTLType = 'default',
    ): Promise<T> {
        const cached = await this.get<T>(key);
        if (cached !== undefined && cached !== null) {
            return cached;
        }
        return this.coalesce(key, async () => {
            const value = await fetchFn();
            if (value !== undefined && value !== null) {
                await this.set(key, value, ttlType);
            }
            return value;
        });
    }

    /**
     * Stale-while-revalidate read. Values are stored with a soft expiry
     * (`ttlType`) and kept for an extra `staleTtlSeconds`. A stale hit is served
     * immediately while a single background refresh runs; a failed refresh keeps
     * the stale value rather than poisoning the cache. A short-lived distributed
     * lock limits refreshes to one instance; if the lock holder dies the lock
     * expires after `lockTtlMs`.
     */
    async getOrSetStaleWhileRevalidate<T>(
        key: string,
        fetchFn: () => Promise<T>,
        ttlType: CacheTTLType = 'default',
        options: { staleTtlSeconds?: number; lockTtlMs?: number } = {},
    ): Promise<T> {
        const staleTtl = options.staleTtlSeconds ?? this.ttlConfig[ttlType];
        const lockTtlMs = options.lockTtlMs ?? 5000;
        const entry = await this.get<{ v: T; freshUntil: number }>(key);

        if (entry && entry.v !== undefined && entry.v !== null) {
            if (entry.freshUntil > Date.now()) return entry.v;
            this.stampedeMetrics.staleServed++;
            void this.refreshWithLock(key, fetchFn, ttlType, staleTtl, lockTtlMs).catch(() => undefined);
            return entry.v;
        }

        return this.coalesce(key, () => this.loadEnvelope(key, fetchFn, ttlType, staleTtl));
    }

    private async refreshWithLock<T>(
        key: string,
        fetchFn: () => Promise<T>,
        ttlType: CacheTTLType,
        staleTtl: number,
        lockTtlMs: number,
    ): Promise<void> {
        if (this.inflightRequests.has(key)) {
            this.stampedeMetrics.coalesced++;
            return;
        }
        const lockKey = `${key}:lock`;
        const token = `${process.pid}:${Math.random().toString(36).slice(2)}`;
        if (await this.get<string>(lockKey)) {
            this.stampedeMetrics.lockContention++;
            return;
        }
        await this.cacheManager.set(lockKey, token, lockTtlMs);
        try {
            await this.coalesce(key, () => this.loadEnvelope(key, fetchFn, ttlType, staleTtl));
        } finally {
            // Only release the lock we own; an expired lock may belong to another instance.
            if ((await this.get<string>(lockKey)) === token) {
                await this.cacheManager.del(lockKey);
            }
        }
    }

    private async loadEnvelope<T>(
        key: string,
        fetchFn: () => Promise<T>,
        ttlType: CacheTTLType,
        staleTtl: number,
    ): Promise<T> {
        const value = await fetchFn();
        if (value !== undefined && value !== null) {
            const freshTtl = this.ttlConfig[ttlType];
            await this.cacheManager.set(
                key,
                { v: value, freshUntil: Date.now() + freshTtl * 1000 },
                (freshTtl + staleTtl) * 1000,
            );
        }
        return value;
    }

    /** Ensure only one loader per key runs in this process; failures evict the in-flight entry. */
    private coalesce<T>(key: string, loader: () => Promise<T>): Promise<T> {
        const existing = this.inflightRequests.get(key);
        if (existing) {
            this.stampedeMetrics.coalesced++;
            return existing as Promise<T>;
        }
        this.stampedeMetrics.loads++;
        const promise = loader()
            .catch((err) => {
                this.stampedeMetrics.loaderFailures++;
                this.logger.warn(`Cache loader failed for ${key}: ${(err as Error)?.message}`);
                throw err;
            })
            .finally(() => this.inflightRequests.delete(key));
        this.inflightRequests.set(key, promise);
        return promise;
    }

    getTTL(ttlType: CacheTTLType): number {
        return this.ttlConfig[ttlType];
    }
}
