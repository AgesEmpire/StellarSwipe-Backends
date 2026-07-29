import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  CorrelationIdStore,
  CORRELATION_ID_HEADER,
} from '../correlation/correlation-id.store';

/**
 * NestJS interceptor that ensures the `x-correlation-id` header is always
 * present on every HTTP response and that the correlation context is
 * accessible throughout the full interceptor chain.
 *
 * Placement in the chain:
 * - Runs after CorrelationIdMiddleware (which assigns the ID at the Express
 *   layer), giving downstream interceptors, guards and handlers reliable
 *   access to the ID via CorrelationIdStore or the response header.
 * - Provides an explicit fallback: if the middleware somehow was not applied
 *   (e.g. controller-level usage, direct instantiation in tests) it generates
 *   a fresh UUID and stores it in CorrelationIdStore for that call chain.
 *
 * Benefits over middleware-only approach:
 * - Visible in the NestJS interceptor chain (easier to reason about order).
 * - Can be applied at controller or route scope via @UseInterceptors().
 * - Guarantees the header is set even if CorrelationIdMiddleware is removed.
 * - Adds the correlation ID to async-task metadata (stored in CorrelationIdStore)
 *   so queue producers, workers and any service can tag log lines correctly.
 */
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  constructor(private readonly correlationIdStore: CorrelationIdStore) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Skip for non-HTTP contexts (WebSockets, RPC, etc.)
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    // Resolve the correlation ID.  CorrelationIdMiddleware runs before the
    // interceptor chain and stores the ID in AsyncLocalStorage; we prefer
    // that so both layers share exactly the same ID.  Falling back to the
    // request header covers the case where only the interceptor is active
    // (e.g., in tests or controller-scoped usage).  Generating a new UUID
    // is the last resort so the interceptor is always safe to use standalone.
    const correlationId =
      this.correlationIdStore.getCorrelationId() ??
      (req.headers[CORRELATION_ID_HEADER] as string | undefined) ??
      uuidv4();

    // Ensure the response header is set.  The middleware already does this in
    // the normal path, but setting it here is idempotent and guarantees it is
    // present when the interceptor is used without the middleware.
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    // If no store context is active (standalone usage), seed one so
    // downstream code — including async task producers — can read it via
    // CorrelationIdStore.getCorrelationId().
    if (!this.correlationIdStore.getCorrelationId()) {
      req.headers[CORRELATION_ID_HEADER] = correlationId;
      (req as any).correlationId = correlationId;

      return new Observable((subscriber) => {
        this.correlationIdStore.run(
          {
            correlationId,
            requestPath: req.path,
            method: req.method,
            userId: (req as any).user?.id,
          },
          () => {
            next
              .handle()
              .pipe(tap({ complete: () => {} }))
              .subscribe(subscriber);
          },
        );
      });
    }

    return next.handle();
  }
}
