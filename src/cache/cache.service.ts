import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';

export enum CachePrefix {
    SESSION = 'stellarswipe:session:',
    SIGNAL = 'stellarswipe:signal:',
    PORTFOLIO = 'stellarswipe:portfolio:',
    SDEX = 'stellarswipe:sdex:',
}

export type CacheTTLType = 'session' | 'signal' | 'portfolio' | 'default';

@Injectable()
export class CacheService {
    private readonly logger = new Logger(CacheService.name);
    private readonly ttlConfig: Record<CacheTTLType, number>;

    constructor(
        @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
        private readonly configService: ConfigService,
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
            return await this.cacheManager.get<T>(key);
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
}
