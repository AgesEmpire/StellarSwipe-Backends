import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Thrown when a request is missing a required idempotency key.
 * Mapped to HTTP 400 by the caller / exception filter.
 */
export class MissingIdempotencyKeyError extends Error {
  constructor(message = 'Idempotency-Key header is required for this operation') {
    super(message);
    this.name = 'MissingIdempotencyKeyError';
  }
}

/**
 * Thrown when the same idempotency key is reused with a different payload.
 * Mapped to HTTP 409 by the caller / exception filter.
 */
export class IdempotencyConflictError extends Error {
  constructor(message = 'Idempotency-Key was reused with a different request payload') {
    super(message);
    this.name = 'IdempotencyConflictError';
  }
}

/**
 * Thrown when a request with the same key is still being processed.
 * Mapped to HTTP 409 by the caller / exception filter.
 */
export class IdempotencyInFlightError extends Error {
  constructor(message = 'A request with this Idempotency-Key is already in progress') {
    super(message);
    this.name = 'IdempotencyInFlightError';
  }
}

export type IdempotencyStatus = 'in_progress' | 'completed';

export interface IdempotencyRecord<T = unknown> {
  key: string;
  requestHash: string;
  status: IdempotencyStatus;
  response?: T;
  createdAt: number;
  updatedAt: number;
}

export interface IdempotencyOptions {
  /** Time-to-live for stored records, in milliseconds. Defaults to 24h. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * IdempotencyService
 *
 * Deduplicates payment-like mutations by storing the result state keyed by a
 * client-supplied idempotency key. Retries with the same key and payload return
 * the original result instead of reprocessing. Concurrent requests with the
 * same key are rejected as in-flight, and key reuse with a different payload is
 * rejected as a conflict.
 *
 * The store is in-memory and process-local. For multi-instance deployments the
 * backing map should be swapped for a shared store (e.g. Redis) while keeping
 * this interface stable.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly store = new Map<string, IdempotencyRecord>();
  private readonly ttlMs: number;

  constructor(options: IdempotencyOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Execute a mutation under an idempotency key.
   *
   * - First call: runs `handler`, stores the result, and returns it.
   * - Retry with same key + payload: returns the stored result without re-running.
   * - Retry with same key + different payload: throws IdempotencyConflictError.
   * - Concurrent call with same key: throws IdempotencyInFlightError.
   * - Missing key: throws MissingIdempotencyKeyError.
   */
  async execute<T>(
    key: string | undefined | null,
    payload: unknown,
    handler: () => Promise<T>,
  ): Promise<T> {
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      throw new MissingIdempotencyKeyError();
    }

    const normalizedKey = key.trim();
    const requestHash = this.hashPayload(payload);
    this.evictExpired();

    const existing = this.store.get(normalizedKey);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        this.logger.warn(
          `Idempotency conflict for key=${normalizedKey}: payload hash mismatch`,
        );
        throw new IdempotencyConflictError();
      }

      if (existing.status === 'in_progress') {
        this.logger.warn(
          `Idempotency in-flight for key=${normalizedKey}: duplicate request rejected`,
        );
        throw new IdempotencyInFlightError();
      }

      this.logger.log(`Idempotency replay for key=${normalizedKey}`);
      return existing.response as T;
    }

    const now = Date.now();
    this.store.set(normalizedKey, {
      key: normalizedKey,
      requestHash,
      status: 'in_progress',
      createdAt: now,
      updatedAt: now,
    });

    try {
      const response = await handler();
      this.store.set(normalizedKey, {
        key: normalizedKey,
        requestHash,
        status: 'completed',
        response,
        createdAt: now,
        updatedAt: Date.now(),
      });
      this.logger.log(`Idempotency completed for key=${normalizedKey}`);
      return response;
    } catch (error) {
      // Do not persist failed attempts so the client can safely retry.
      this.store.delete(normalizedKey);
      this.logger.warn(
        `Idempotency handler failed for key=${normalizedKey}: ${(error as Error)?.message}`,
      );
      throw error;
    }
  }

  /** Returns the stored record for a key, if any (observability/testing). */
  get(key: string): IdempotencyRecord | undefined {
    this.evictExpired();
    return this.store.get(key);
  }

  /** Clears all stored records (testing/administrative use). */
  clear(): void {
    this.store.clear();
  }

  private hashPayload(payload: unknown): string {
    let serialized: string;
    try {
      serialized = JSON.stringify(payload ?? null);
    } catch {
      serialized = String(payload);
    }
    return createHash('sha256').update(serialized).digest('hex');
  }

  private evictExpired(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, record] of this.store.entries()) {
      if (record.updatedAt < cutoff) {
        this.store.delete(key);
      }
    }
  }
}
