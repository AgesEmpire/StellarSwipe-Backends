import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CacheService } from './cache.service';

/**
 * CacheWarmupService
 *
 * Warms critical cache entries on application startup to reduce cold-start
 * latency for frequently accessed data (market data, config, etc.).
 *
 * Resolves: #488 – Cache warming for critical data on startup
 */
@Injectable()
export class CacheWarmupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CacheWarmupService.name);

  /** Registry of warmup tasks: key → async factory */
  private readonly warmupTasks = new Map<string, () => Promise<unknown>>();

  constructor(private readonly cacheService: CacheService) {}

  /**
   * Register a warmup task. The factory is called once on startup and the
   * result is stored in cache under `key` with the given TTL (seconds).
   */
  register(key: string, factory: () => Promise<unknown>, ttlSeconds: number): void {
    this.warmupTasks.set(key, async () => {
      const value = await factory();
      await this.cacheService.setWithTTL(key, value, ttlSeconds);
      return value;
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.warmupTasks.size === 0) {
      this.logger.log('No cache warmup tasks registered – skipping');
      return;
    }

    this.logger.log(`Warming ${this.warmupTasks.size} cache entries…`);

    const results = await Promise.allSettled(
      Array.from(this.warmupTasks.entries()).map(async ([key, task]) => {
        await task();
        this.logger.debug(`Warmed cache key: ${key}`);
      }),
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      this.logger.warn(`Cache warmup: ${failed.length}/${results.length} tasks failed`);
      failed.forEach((r) => {
        if (r.status === 'rejected') {
          this.logger.error('Warmup task error:', r.reason);
        }
      });
    } else {
      this.logger.log(`Cache warmup complete (${results.length} entries)`);
    }
  }
}
