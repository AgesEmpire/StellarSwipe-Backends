import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

export const CORRELATION_HEADER = 'x-correlation-id';
// Accept UUIDs or opaque tokens of safe chars, 8-128 long. Anything else is replaced.
const VALID_ID = /^[A-Za-z0-9._-]{8,128}$/;

const storage = new AsyncLocalStorage<{ correlationId: string }>();

export const isValidCorrelationId = (id: unknown): id is string =>
  typeof id === 'string' && VALID_ID.test(id);

export const getCorrelationId = (): string | undefined =>
  storage.getStore()?.correlationId;

/** Headers to attach to downstream HTTP calls so the ID is preserved. */
export const correlationHeaders = (): Record<string, string> => {
  const id = getCorrelationId();
  return id ? { [CORRELATION_HEADER]: id } : {};
};

export const runWithCorrelationId = <T>(id: string, fn: () => T): T =>
  storage.run({ correlationId: id }, fn);

/** Express middleware: accept a valid inbound ID or generate one, expose it on req/res. */
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers[CORRELATION_HEADER];
  const id = isValidCorrelationId(incoming) ? incoming : randomUUID();
  (req as any).correlationId = id;
  req.headers[CORRELATION_HEADER] = id;
  res.setHeader(CORRELATION_HEADER, id);
  runWithCorrelationId(id, next);
}
