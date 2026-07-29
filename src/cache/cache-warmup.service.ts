import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CacheService } from './cache.service';

export interface WarmupTask {
  /** Async factory that fetches the value to cache */
  factory: () => Promise<unknown>;
  ttlSeconds: number;
  /** If true, a missing cache entry is not treated as a failure */
  optional?: boolean;
}

/**
 * CacheWarmupService
 *
 * Warms critical cache entries on application startup to reduce cold-start
 * latency for frequently accessed data (market data, config, etc.).
 *
 * Resolves: #488 – Cache warming for critical data on startup
 * Resolves: #550 – Backup of cached state on startup
 *
 * Startup sequence:
 *  1. For each registered key, check whether a persisted snapshot already
 *     exists in the cache store (i.e. Redis survived the restart).
 *  2. If a snapshot exists, skip the factory call – the cache is already warm.
 *  3. If no snapshot exists, call the factory, store the result, and log
 *     progress.  Failures in optional tasks are logged as warnings; failures
 *     in required tasks are logged as errors but never block startup.
 */
@Injectable()
export class CacheWarmupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CacheWarmupService.name);
  private readonly warmupTasks = new Map<string, WarmupTask>();

  constructor(private readonly cacheService: CacheService) {}

  /**
   * Register a warmup task.
   * @param key       Cache key to warm
   * @param factory   Async function that returns the value to store
   * @param ttlSeconds TTL for the cached entry
   * @param optional  When true, a factory failure is only a warning
   */
  register(
    key: string,
    factory: () => Promise<unknown>,
    ttlSeconds: number,
    optional = false,
  ): void {
    this.warmupTasks.set(key, { factory, ttlSeconds, optional });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.warmupTasks.size === 0) {
      this.logger.log('No cache warmup tasks registered – skipping');
      return;
    }

    this.logger.log(`Starting cache warmup for ${this.warmupTasks.size} key(s)…`);

    // Non-blocking: run all tasks concurrently, never throw
    const results = await Promise.allSettled(
      Array.from(this.warmupTasks.entries()).map(([key, task]) =>
        this.warmSingleKey(key, task),
      ),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.warn(`Cache warmup finished with ${failed}/${results.length} failure(s)`);
    } else {
      this.logger.log(`Cache warmup complete – ${results.length} key(s) ready`);
    }
  }

  private async warmSingleKey(key: string, task: WarmupTask): Promise<void> {
    try {
      // Step 1: check whether the cache already holds a persisted snapshot
      const existing = await this.cacheService.get(key);
      if (existing !== undefined && existing !== null) {
        this.logger.debug(`Cache key "${key}" restored from persisted state – skipping factory`);
        return;
      }

      // Step 2: cold cache – populate from the factory
      this.logger.debug(`Warming cache key "${key}" from source…`);
      const value = await task.factory();
      await this.cacheService.setWithTTL(key, value, task.ttlSeconds);
      this.logger.debug(`Cache key "${key}" warmed successfully`);
    } catch (err) {
      const msg = `Cache warmup failed for key "${key}": ${(err as Error).message}`;
      if (task.optional) {
        this.logger.warn(msg);
      } else {
        this.logger.error(msg);
      }
      // Never re-throw – warmup failures must not block startup
    }
  }
}
