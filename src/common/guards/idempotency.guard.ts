import {
  BadRequestException,
  CanActivate,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { createHash } from 'crypto';

/**
 * Header used by clients to supply an idempotency key for payment-like
 * mutations. The value must be a non-empty string (typically a UUID).
 */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * How long a stored idempotency record is retained. Retries after this window
 * are treated as new requests.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

interface IdempotencyRecord {
  /** Hash of the request payload used to detect key reuse with a different body. */
  requestHash: string;
  /** HTTP status of the original response, once available. */
  status?: number;
  /** Serialized response body of the original request, once available. */
  body?: unknown;
  /** In-flight promise resolved when the original request completes. */
  pending?: Promise<void>;
  /** Resolver for the in-flight promise. */
  resolve?: () => void;
  /** Timestamp used for TTL eviction. */
  createdAt: number;
}

/**
 * Guard that enforces idempotency for payment-like mutation endpoints.
 *
 * - Requires a client-supplied `Idempotency-Key` header, rejecting requests
 *   that omit it with a 400.
 * - Persists the result state (status + response payload) keyed by the
 *   idempotency key so retries return the original result instead of
 *   reprocessing the mutation.
 * - Deduplicates concurrent requests: a second request with the same key while
 *   the first is still in-flight waits for and replays the original result.
 * - Detects key reuse with a different payload and rejects it with a 409.
 */
@Injectable()
export class IdempotencyGuard implements CanActivate {
  private readonly logger = new Logger(IdempotencyGuard.name);
  private readonly store = new Map<string, IdempotencyRecord>();

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      throw new BadRequestException(
        `Missing required ${IDEMPOTENCY_KEY_HEADER} header for this operation.`,
      );
    }

    const normalizedKey = key.trim();
    const requestHash = this.hashRequest(request);
    this.evictExpired();

    const existing = this.store.get(normalizedKey);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency key was reused with a different request payload.',
        );
      }

      if (existing.pending) {
        // Concurrent duplicate: wait for the original request to finish, then
        // replay its stored result.
        await existing.pending;
      }

      if (existing.status !== undefined) {
        this.logger.log(
          `Replaying idempotent response for key ${normalizedKey} (status ${existing.status}).`,
        );
        response.status(existing.status);
        response.json(existing.body);
        return false;
      }
    }

    const record: IdempotencyRecord = existing ?? {
      requestHash,
      createdAt: Date.now(),
    };

    if (!existing) {
      record.pending = new Promise<void>((resolve) => {
        record.resolve = resolve;
      });
      this.store.set(normalizedKey, record);
    }

    // Capture the response so the result can be persisted for replays.
    const originalJson = response.json.bind(response);
    response.json = ((body: unknown) => {
      record.status = response.statusCode;
      record.body = body;
      record.pending = undefined;
      record.resolve?.();
      return originalJson(body);
    }) as Response['json'];

    return true;
  }

  private hashRequest(request: Request): string {
    const payload = JSON.stringify({
      method: request.method,
      path: request.originalUrl ?? request.url,
      body: request.body ?? null,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, record] of this.store) {
      if (!record.pending && now - record.createdAt > IDEMPOTENCY_TTL_MS) {
        this.store.delete(key);
      }
    }
  }
}
