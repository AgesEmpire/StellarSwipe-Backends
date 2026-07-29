import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

/** Header used to propagate the correlation ID across services. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

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
