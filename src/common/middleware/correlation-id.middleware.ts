import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  CorrelationIdStore,
  CORRELATION_ID_HEADER,
} from '../correlation/correlation-id.store';

/**
 * Assigns a correlation ID to every inbound request — reusing the
 * caller-supplied `x-correlation-id` header when present so correlation
 * survives across service hops, or generating a fresh UUID otherwise.
 *
 * The ID is echoed back in the response header and stored in
 * CorrelationIdStore for the lifetime of the request so downstream
 * services, interceptors and the logger can all read it without it being
 * passed explicitly.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly correlationIdStore: CorrelationIdStore) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_ID_HEADER];
    const correlationId =
      (Array.isArray(incoming) ? incoming[0] : incoming) || uuidv4();

    req.headers[CORRELATION_ID_HEADER] = correlationId;
    (req as any).correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    this.correlationIdStore.run(
      {
        correlationId,
        requestPath: req.path,
        method: req.method,
        userId: (req as any).user?.id,
      },
      () => next(),
    );
  }
}
