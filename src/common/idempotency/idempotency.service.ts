import {
  Injectable,
  Inject,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as crypto from 'crypto';

export interface IdempotencyRecord {
  /** SHA-256 of the canonical request body */
  fingerprint: string;
  /** Serialized successful response (JSON) */
  response: string;
  /** HTTP status that was returned */
  statusCode: number;
  createdAt: number;
}

/**
 * Bounded idempotency store for command endpoints (issue #1009).
 *
 * Flow:
 * 1. Client sends `Idempotency-Key` header.
 * 2. Service hashes the request body → fingerprint.
 * 3. If key exists with the same fingerprint → replay stored response.
 * 4. If key exists with a different fingerprint → 409 Conflict.
 * 5. Otherwise execute the handler and persist the result for `ttlMs`.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  /** Default retention: 24 hours */
  static readonly DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

  private cacheKey(scope: string, key: string): string {
    return `idempotency:${scope}:${key}`;
  }

  /** Canonical fingerprint of the request payload. */
  fingerprint(body: unknown): string {
    const canonical = JSON.stringify(body ?? null);
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Look up an existing record.
   * Returns null when the key is free.
   */
  async get(
    scope: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const raw = await this.cache.get<IdempotencyRecord>(
      this.cacheKey(scope, key),
    );
    return raw ?? null;
  }

  /**
   * Store a successful response for later replay.
   */
  async save(
    scope: string,
    key: string,
    fingerprint: string,
    response: unknown,
    statusCode: number,
    ttlMs: number = IdempotencyService.DEFAULT_TTL_MS,
  ): Promise<void> {
    const record: IdempotencyRecord = {
      fingerprint,
      response: JSON.stringify(response),
      statusCode,
      createdAt: Date.now(),
    };
    await this.cache.set(this.cacheKey(scope, key), record, ttlMs);
    this.logger.debug(
      `Stored idempotency record scope=${scope} key=${key.slice(0, 8)}…`,
    );
  }

  /**
   * Execute `handler` under idempotency protection.
   *
   * @param scope   Logical namespace (e.g. "orders:market")
   * @param key     Client-supplied Idempotency-Key
   * @param body    Request body used for fingerprinting
   * @param handler Async function that performs the real work
   */
  async run<T>(
    scope: string,
    key: string,
    body: unknown,
    handler: () => Promise<T>,
  ): Promise<{ result: T; replayed: boolean }> {
    if (!key || typeof key !== 'string' || key.length < 8 || key.length > 256) {
      // Treat missing/invalid key as non-idempotent — just run the handler.
      const result = await handler();
      return { result, replayed: false };
    }

    const fp = this.fingerprint(body);
    const existing = await this.get(scope, key);

    if (existing) {
      if (existing.fingerprint !== fp) {
        throw new ConflictException(
          'Idempotency-Key was already used with a different request payload',
        );
      }
      this.logger.log(
        `Idempotency hit scope=${scope} key=${key.slice(0, 8)}… — replaying stored response`,
      );
      return {
        result: JSON.parse(existing.response) as T,
        replayed: true,
      };
    }

    const result = await handler();
    await this.save(scope, key, fp, result, 201);
    return { result, replayed: false };
  }
}
