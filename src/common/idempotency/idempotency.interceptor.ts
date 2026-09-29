import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const IDEMPOTENT_KEY = 'idempotent';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/** Mark a POST/PUT/DELETE handler as idempotent. ttlMs controls record expiry. */
export const Idempotent = (options: { ttlMs?: number; required?: boolean } = {}) =>
  SetMetadata(IDEMPOTENT_KEY, options);

interface IdempotencyRecord {
  fingerprint: string;
  status: 'in_progress' | 'completed';
  statusCode?: number;
  body?: unknown;
  expiresAt: number;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly records = new Map<string, IdempotencyRecord>();

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.get<{ ttlMs?: number; required?: boolean }>(
      IDEMPOTENT_KEY,
      context.getHandler(),
    );
    if (!options || context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next.handle();

    const key = req.headers[IDEMPOTENCY_HEADER];
    if (!key) {
      if (options.required) throw new BadRequestException(`${IDEMPOTENCY_HEADER} header is required`);
      return next.handle();
    }
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,255}$/.test(key)) {
      throw new BadRequestException(`Invalid ${IDEMPOTENCY_HEADER} header`);
    }

    this.evictExpired();
    const scope = `${req.user?.id ?? 'anon'}:${req.method}:${req.route?.path ?? req.path}:${key}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');
    const existing = this.records.get(scope);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new UnprocessableEntityException('Idempotency key reused with a different payload');
      }
      if (existing.status === 'in_progress') {
        throw new ConflictException('A request with this idempotency key is already in progress');
      }
      res.status(existing.statusCode);
      res.setHeader('Idempotent-Replayed', 'true');
      return of(existing.body);
    }

    // Reserve synchronously so concurrent requests with the same key cannot both execute.
    const record: IdempotencyRecord = {
      fingerprint,
      status: 'in_progress',
      expiresAt: Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS),
    };
    this.records.set(scope, record);

    return next.handle().pipe(
      tap((body) => {
        record.status = 'completed';
        record.statusCode = res.statusCode;
        record.body = body;
      }),
      catchError((err) => {
        // Failed executions are not cached so the client can retry.
        this.records.delete(scope);
        return throwError(() => err);
      }),
    );
  }

  private evictExpired() {
    const now = Date.now();
    for (const [k, r] of this.records) if (r.expiresAt <= now) this.records.delete(k);
  }
}
