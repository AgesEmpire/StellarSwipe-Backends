import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

const LOCK_PREFIX = 'stellarswipe:lock:';
const FENCE_PREFIX = 'stellarswipe:fence:';
export const MAX_LOCK_TTL_MS = 24 * 60 * 60 * 1000;

const ACQUIRE_SCRIPT = `
if redis.call("exists", KEYS[1]) == 1 then
  return false
end
local fencingToken = redis.call("incr", KEYS[2])
redis.call("set", KEYS[1], ARGV[1], "PX", ARGV[2])
return fencingToken
`;

const IS_CURRENT_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return 1
else
  return 0
end
`;

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
  fencingToken?: number;
}

export interface LockExecutionContext {
  /** Monotonically increasing per lock key; protected resources should reject older tokens. */
  readonly fencingToken: number;
  /** Aborted as soon as lease renewal discovers that ownership has been lost. */
  readonly signal: AbortSignal;
  /** Call immediately before committing protected work. Throws if the lease is no longer owned. */
  assertCurrent(): Promise<void>;
}

export class LockLeaseLostError extends Error {
  constructor(key: string) {
    super(`Lease ownership for lock "${key}" has been lost.`);
    this.name = 'LockLeaseLostError';
  }
}

/**
 * Reusable Redis-backed distributed lock for scheduled/queue-backed work
 * that must run once across multiple NestJS instances.
 *
 * - Acquire uses one Lua transaction to check the lease, increment a
 *   persistent per-lock fencing counter, and write a bounded-TTL owner key.
 *   The TTL bounds how long a crashed holder can
 *   block the lock, so a dead worker can never cause permanent blockage.
 * - Every acquisition is stamped with a random ownership token (UUID).
 *   Release and renew both run as Lua scripts that compare-and-swap on
 *   that token, so a worker can never release or extend a lock it no
 *   longer owns (e.g. after its own lease already expired and someone
 *   else acquired it).
 * - `withLock` auto-renews the lease at roughly 1/3 of the TTL. Handlers
 *   receive a fencing token and must call `assertCurrent()` at protected
 *   commit boundaries; persisted resources should also reject writes carrying
 *   an older fencing token. The signal is aborted if lease ownership is lost.
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
   * Atomically checks the lease, increments its persistent fencing counter,
   * and stores the owner token with a bounded TTL.
   *
   * @param key   Lock identifier (job name).
   * @param ttlMs Lock time-to-live in milliseconds. Should be slightly longer
   *              than the expected job duration to avoid deadlock on crash.
   * @returns     A random ownership token if the lock was acquired, or
   *              `null` if another replica already holds it. Supply the token
   *              to `release`/`renew`; use `withLock` to also receive a fence.
   */
  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const lease = await this.acquireLease(key, ttlMs);
    return lease?.token ?? null;
  }

  private async acquireLease(
    key: string,
    ttlMs: number,
  ): Promise<{ token: string; fencingToken: number } | null> {
    this.validateTtl(ttlMs);
    const token = randomUUID();
    const result = await this.redis.eval(
      ACQUIRE_SCRIPT,
      2,
      `${LOCK_PREFIX}${key}`,
      `${FENCE_PREFIX}${key}`,
      token,
      ttlMs,
    );
    if (result === null || result === false) {
      return null;
    }
    const fencingToken = Number(result);
    if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) {
      throw new Error(`Redis returned an invalid fencing token for lock "${key}".`);
    }
    return { token, fencingToken };
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
    this.validateTtl(ttlMs);
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
    fn: (context: LockExecutionContext) => Promise<T>,
  ): Promise<WithLockResult<T>> {
    this.validateTtl(ttlMs);
    const lease = await this.acquireLease(key, ttlMs);
    if (!lease) {
      this.logger.debug(`Lock "${key}" already held by another replica — skipping`);
      return { ran: false };
    }

    const { token, fencingToken } = lease;
    const abortController = new AbortController();
    let leaseLost = false;
    let renewalInProgress = false;
    const context: LockExecutionContext = {
      fencingToken,
      signal: abortController.signal,
      assertCurrent: async () => {
        if (leaseLost || !(await this.isCurrent(key, token))) {
          leaseLost = true;
          abortController.abort();
          throw new LockLeaseLostError(key);
        }
      },
    };

    const renewIntervalMs = Math.max(Math.floor(ttlMs / 3), 1);
    const heartbeat = setInterval(async () => {
      if (renewalInProgress || leaseLost) {
        return;
      }
      renewalInProgress = true;
      try {
        const renewed = await this.renew(key, token, ttlMs);
        if (!renewed) {
          leaseLost = true;
          abortController.abort();
          this.logger.warn(`Lease renewal for lock "${key}" failed — ownership may have been lost`);
        }
      } finally {
        renewalInProgress = false;
      }
    }, renewIntervalMs);
    // Don't let the heartbeat keep the Node process alive on its own.
    heartbeat.unref?.();

    try {
      const result = await fn(context);
      await context.assertCurrent();
      return { ran: true, result, fencingToken };
    } finally {
      clearInterval(heartbeat);
      await this.release(key, token);
    }
  }

  private async isCurrent(key: string, token: string): Promise<boolean> {
    const result = await this.redis.eval(
      IS_CURRENT_SCRIPT,
      1,
      `${LOCK_PREFIX}${key}`,
      token,
    );
    return result === 1;
  }

  private validateTtl(ttlMs: number): void {
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 100 ||
      ttlMs > MAX_LOCK_TTL_MS
    ) {
      throw new RangeError(
        `Lock TTL must be an integer between 100 and ${MAX_LOCK_TTL_MS} milliseconds.`,
      );
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }
}
