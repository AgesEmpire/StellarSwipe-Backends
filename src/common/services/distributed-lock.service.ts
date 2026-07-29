import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const LOCK_PREFIX = 'stellarswipe:lock:';

@Injectable()
export class DistributedLockService implements OnModuleDestroy {
  private readonly logger = new Logger(DistributedLockService.name);
  private readonly redis: Redis;

  constructor(private readonly configService: ConfigService) {
    this.redis = new Redis({
      host: this.configService.get<string>('REDIS_HOST', 'localhost'),
      port: this.configService.get<number>('REDIS_PORT', 6379),
      password: this.configService.get<string>('REDIS_PASSWORD'),
      lazyConnect: false,
    });
  }

  /**
   * Attempts to acquire a named lock with a TTL.
   * Uses SET NX PX which is atomic on Redis — only one caller wins per tick.
   *
   * @param key   Lock identifier (job name).
   * @param ttlMs Lock time-to-live in milliseconds. Should be slightly longer
   *              than the expected job duration to avoid deadlock on crash.
   * @returns     true if the lock was acquired, false if another replica holds it.
   */
  async acquire(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.set(`${LOCK_PREFIX}${key}`, '1', 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  /**
   * Releases the lock by deleting the key.
   * Silently ignores errors — the TTL ensures eventual release on crash.
   */
  async release(key: string): Promise<void> {
    try {
      await this.redis.del(`${LOCK_PREFIX}${key}`);
    } catch (err) {
      this.logger.warn(`Failed to release lock "${key}": ${(err as Error).message}`);
    }
  }

  /**
   * Convenience wrapper: runs `fn` only if the lock is acquired.
   * Releases the lock when `fn` completes or throws.
   *
   * @returns true if the job ran, false if the lock was already held.
   */
  async withLock<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<{ ran: boolean; result?: T }> {
    const acquired = await this.acquire(key, ttlMs);
    if (!acquired) {
      this.logger.debug(`Lock "${key}" already held by another replica — skipping`);
      return { ran: false };
    }

    try {
      const result = await fn();
      return { ran: true, result };
    } finally {
      await this.release(key);
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
