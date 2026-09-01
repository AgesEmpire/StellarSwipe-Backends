import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

const LOCK_PREFIX = 'stellarswipe:lock:';

/**
 * CAS-safe release: only deletes the key if the value still matches the
 * caller's ownership token. Prevents a worker whose lease already expired
 * (and was re-acquired by someone else) from deleting the new holder's lock.
 */
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

/**
 * CAS-safe renew: only extends the TTL if the value still matches the
 * caller's ownership token. Lets a long-running job extend its lease
 * without risking clobbering someone else's lock after an expiry race.
 */
const RENEW_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

export interface WithLockResult<T> {
  ran: boolean;
  result?: T;
}

/**
 * Reusable Redis-backed distributed lock for scheduled/queue-backed work
 * that must run once across multiple NestJS instances.
 *
 * - Acquire uses `SET key token PX ttlMs NX`, which is atomic — only one
 *   caller wins per tick. The TTL bounds how long a crashed holder can
 *   block the lock, so a dead worker can never cause permanent blockage.
 * - Every acquisition is stamped with a random ownership token (UUID).
 *   Release and renew both run as Lua scripts that compare-and-swap on
 *   that token, so a worker can never release or extend a lock it no
 *   longer owns (e.g. after its own lease already expired and someone
 *   else acquired it).
 * - `withLock` auto-renews the lease at roughly 1/3 of the TTL while the
 *   guarded function runs, so long jobs don't lose ownership mid-run —
 *   while still falling back to TTL expiry if the process dies outright.
 */
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
   * @returns     A random ownership token if the lock was acquired, or
   *              `null` if another replica already holds it. The token must
   *              be supplied to `release`/`renew` — it proves the caller is
   *              still the current holder.
   */
  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(`${LOCK_PREFIX}${key}`, token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  /**
   * Releases the lock, but only if `token` still matches the current
   * holder. Runs as a Lua script so the compare-and-delete is atomic —
   * a worker can never release a lock it no longer owns (e.g. its lease
   * already expired and another replica acquired it in the meantime).
   *
   * @returns true if this call actually deleted the lock, false if the
   *          token didn't match (or the key was already gone).
   */
  async release(key: string, token: string): Promise<boolean> {
    try {
      const deleted = await this.redis.eval(RELEASE_SCRIPT, 1, `${LOCK_PREFIX}${key}`, token);
      return deleted === 1;
    } catch (err) {
      this.logger.warn(`Failed to release lock "${key}": ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Extends the TTL of a held lock, but only if `token` still matches the
   * current holder. Runs as a Lua script so the compare-and-expire is
   * atomic. Use this to keep a lease alive across a long-running job
   * without risking extending a lock that has since passed to another
   * worker.
   *
   * @returns true if the TTL was extended, false if the token didn't
   *          match (the lease was already lost) or the key was gone.
   */
  async renew(key: string, token: string, ttlMs: number): Promise<boolean> {
    try {
      const renewed = await this.redis.eval(RENEW_SCRIPT, 1, `${LOCK_PREFIX}${key}`, token, ttlMs);
      return renewed === 1;
    } catch (err) {
      this.logger.warn(`Failed to renew lock "${key}": ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Convenience wrapper: runs `fn` only if the lock is acquired.
   * Automatically renews the lease at roughly 1/3 of `ttlMs` while `fn`
   * runs, so long-running jobs don't lose ownership mid-execution; if the
   * process dies outright, the lock still expires normally via TTL.
   * Releases the lock (CAS-checked against its own token) when `fn`
   * completes or throws.
   *
   * @returns { ran: false } if the lock was already held by another
   *          replica; otherwise { ran: true, result } with `fn`'s result.
   */
  async withLock<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>,
  ): Promise<WithLockResult<T>> {
    const token = await this.acquire(key, ttlMs);
    if (!token) {
      this.logger.debug(`Lock "${key}" already held by another replica — skipping`);
      return { ran: false };
    }

    const renewIntervalMs = Math.max(Math.floor(ttlMs / 3), 100);
    const heartbeat = setInterval(() => {
      void this.renew(key, token, ttlMs).then((renewed) => {
        if (!renewed) {
          this.logger.warn(`Lease renewal for lock "${key}" failed — ownership may have been lost`);
        }
      });
    }, renewIntervalMs);
    // Don't let the heartbeat keep the Node process alive on its own.
    heartbeat.unref?.();

    try {
      const result = await fn();
      return { ran: true, result };
    } finally {
      clearInterval(heartbeat);
      await this.release(key, token);
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
