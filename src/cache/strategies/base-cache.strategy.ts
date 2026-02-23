import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

export interface CacheOptions {
  ttl: number; // seconds
  useL1?: boolean; // in-memory cache
}

@Injectable()
export abstract class BaseCacheStrategy {
  private l1Cache: Map<string, { data: any; expires: number }> = new Map();

  constructor(@Inject(CACHE_MANAGER) protected cacheManager: Cache) {}

  protected async get<T>(key: string, options?: CacheOptions): Promise<T | null> {
    // L1 Cache (in-memory)
    if (options?.useL1 !== false) {
      const l1Data = this.l1Cache.get(key);
      if (l1Data && l1Data.expires > Date.now()) {
        return l1Data.data as T;
      }
      this.l1Cache.delete(key);
    }

    // L2 Cache (Redis)
    const l2Data = await this.cacheManager.get<T>(key);
    if (l2Data) {
      // Populate L1 cache
      if (options?.useL1 !== false && options?.ttl) {
        this.l1Cache.set(key, {
          data: l2Data,
          expires: Date.now() + Math.min(options.ttl, 300) * 1000, // Max 5 min for L1
        });
      }
      return l2Data;
    }

    return null;
  }

  protected async set<T>(key: string, value: T, options: CacheOptions): Promise<void> {
    // L2 Cache (Redis)
    await this.cacheManager.set(key, value, options.ttl * 1000);

    // L1 Cache (in-memory)
    if (options.useL1 !== false) {
      this.l1Cache.set(key, {
        data: value,
        expires: Date.now() + Math.min(options.ttl, 300) * 1000,
      });
    }
  }

  protected async delete(key: string): Promise<void> {
    this.l1Cache.delete(key);
    await this.cacheManager.del(key);
  }

  protected async deletePattern(pattern: string): Promise<void> {
    // Clear L1 cache matching pattern
    const regex = new RegExp(pattern.replace('*', '.*'));
    for (const key of this.l1Cache.keys()) {
      if (regex.test(key)) {
        this.l1Cache.delete(key);
      }
    }

    // Clear L2 cache (Redis pattern matching)
    // Note: This requires Redis SCAN command support
    await this.cacheManager.clear();
  }

  // Cache-aside pattern
  protected async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOptions,
  ): Promise<T> {
    // Try cache first
    const cached = await this.get<T>(key, options);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - fetch from source
    const data = await fetchFn();
    
    // Store in cache
    await this.set(key, data, options);
    
    return data;
  }

  // Cleanup expired L1 entries
  protected cleanupL1(): void {
    const now = Date.now();
    for (const [key, value] of this.l1Cache.entries()) {
      if (value.expires <= now) {
        this.l1Cache.delete(key);
      }
    }
  }
}
