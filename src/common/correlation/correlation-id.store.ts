import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

/** Header used to propagate the correlation ID across services. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Upper bound on an accepted incoming correlation ID length. */
export const MAX_CORRELATION_ID_LENGTH = 128;

/** Caller-supplied IDs must match this shape to be trusted and echoed back. */
const CORRELATION_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

/**
 * Validates a caller-supplied correlation ID before it is trusted, logged,
 * or echoed back in a response header. Rejects anything oversized or
 * containing characters outside a safe allowlist (e.g. header/log
 * injection attempts via CR/LF or other control characters), so an
 * invalid or oversized incoming ID is replaced with a freshly generated
 * one rather than propagated as-is.
 */
export function isValidCorrelationId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CORRELATION_ID_LENGTH &&
    CORRELATION_ID_PATTERN.test(value)
  );
}

export interface CorrelationContext {
  correlationId: string;
  requestPath?: string;
  method?: string;
  userId?: string;
}

/**
 * Request-scoped correlation context backed by AsyncLocalStorage.
 *
 * Populated once per request by CorrelationIdMiddleware and readable from
 * anywhere in the async call chain it spawns (services, guards, queue
 * producers, etc.) without having to thread the ID through every function
 * signature. This is what lets auth, blockchain, cache and worker-enqueue
 * code tag their own log lines with the same correlation ID as the
 * originating request.
 */
@Injectable()
export class CorrelationIdStore {
  private static readonly storage = new AsyncLocalStorage<CorrelationContext>();

  run<T>(context: CorrelationContext, callback: () => T): T {
    return CorrelationIdStore.storage.run(context, callback);
  }

  getContext(): CorrelationContext | undefined {
    return CorrelationIdStore.storage.getStore();
  }

  getCorrelationId(): string | undefined {
    return this.getContext()?.correlationId;
  }
}
