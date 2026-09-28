import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { LockAcquisitionException } from '../exceptions/lock-acquisition.exception';

export interface RunExclusiveOptions {
  /** Poll interval in ms while waiting for a blocking acquire. Default 250ms. */
  pollIntervalMs?: number;
  /** Max time in ms to wait before giving up on a blocking acquire. Default 30_000ms. */
  timeoutMs?: number;
}

/**
 * Postgres session-level advisory locks for coordinating critical maintenance
 * jobs and schema migrations that must never run concurrently against the
 * same resource — e.g. two replicas kicking off the same nightly cleanup job,
 * or a migration racing a long-running data-backfill during a deploy window.
 *
 * Advisory locks live in Postgres itself (not Redis), so they naturally scope
 * to "one database, one lock namespace" and are visible via
 * `pg_locks` / `pg_stat_activity` for operational debugging — see
 * docs/guides/advisory-locking.md.
 *
 * Lock names are arbitrary strings; they are hashed down to a signed 64-bit
 * key because `pg_advisory_lock` only accepts bigint keys.
 */
@Injectable()
export class AdvisoryLockService {
  private readonly logger = new Logger(AdvisoryLockService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Derives a stable signed bigint key from a human-readable lock name so
   * callers can use descriptive identifiers like "maintenance:audit-cleanup".
   */
  private keyFor(lockName: string): string {
    const digest = createHash('sha256').update(lockName).digest();
    // Take the first 8 bytes and mask to fit within a signed 64-bit integer.
    const asBigInt = digest.readBigUInt64BE(0) & 0x7fffffffffffffffn;
    return asBigInt.toString();
  }

  /**
   * Attempts to acquire the lock immediately, without blocking.
   * @returns true if acquired, false if another session already holds it.
   */
  async tryAcquire(lockName: string): Promise<boolean> {
    const key = this.keyFor(lockName);
    const result = await this.dataSource.query('SELECT pg_try_advisory_lock($1) AS acquired', [key]);
    const acquired = Boolean(result?.[0]?.acquired);
    this.logger.debug(`tryAcquire("${lockName}") -> ${acquired}`);
    return acquired;
  }

  /**
   * Releases a previously acquired lock. Safe to call even if the lock was
   * never held by this session — Postgres simply returns false.
   */
  async release(lockName: string): Promise<void> {
    const key = this.keyFor(lockName);
    await this.dataSource.query('SELECT pg_advisory_unlock($1)', [key]);
    this.logger.debug(`release("${lockName}")`);
  }

  /**
   * Blocks (with polling, not a real DB-level wait, so the connection isn't
   * held open the whole time) until the lock is acquired or `timeoutMs`
   * elapses, whichever comes first.
   */
  private async acquireWithTimeout(lockName: string, options: RunExclusiveOptions): Promise<boolean> {
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const deadline = Date.now() + timeoutMs;

    // Fast path: try once before entering the poll loop.
    if (await this.tryAcquire(lockName)) {
      return true;
    }

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      if (await this.tryAcquire(lockName)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Runs `work` while holding the named advisory lock, releasing it
   * afterwards regardless of success or failure.
   *
   * Throws {@link LockAcquisitionException} (HTTP 409) if the lock cannot be
   * acquired within the timeout, so callers get a clear, typed error instead
   * of silently skipping the job or corrupting state via a race.
   */
  async runExclusive<T>(
    lockName: string,
    work: () => Promise<T>,
    options: RunExclusiveOptions = {},
  ): Promise<T> {
    const acquired = await this.acquireWithTimeout(lockName, options);

    if (!acquired) {
      this.logger.warn(`Failed to acquire advisory lock "${lockName}" — refusing to run exclusive work`);
      throw new LockAcquisitionException(lockName);
    }

    this.logger.log(`Acquired advisory lock "${lockName}"`);
    try {
      return await work();
    } finally {
      await this.release(lockName);
      this.logger.log(`Released advisory lock "${lockName}"`);
    }
  }
}
