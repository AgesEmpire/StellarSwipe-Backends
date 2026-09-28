import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SKIP_ENVELOPE_KEY } from '../decorators/skip-envelope.decorator';

export interface ApiMeta {
  timestamp: string;
  page?: number;
  totalPages?: number;
  total?: number;
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
  links?: Record<string, string | null>;
  [key: string]: unknown;
}

export interface ApiEnvelope<T = unknown> {
  data: T;
  meta: ApiMeta;
}

/** Keys that represent pagination metadata and should be hoisted into meta. */
const PAGINATION_KEYS = new Set([
  'page', 'totalPages', 'total', 'limit', 'offset',
  'hasMore', 'nextCursor', 'pagination', 'links',
]);

function splitPayload(payload: unknown): { data: unknown; metaPagination: Record<string, unknown> } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { data: payload, metaPagination: {} };
  }

  const obj = payload as Record<string, unknown>;
  const hasPagination = Object.keys(obj).some((k) => PAGINATION_KEYS.has(k));

  if (!hasPagination) {
    return { data: payload, metaPagination: {} };
  }

  const data: Record<string, unknown> = {};
  const metaPagination: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (PAGINATION_KEYS.has(key)) {
      metaPagination[key] = value;
    } else {
      data[key] = value;
    }
  }

  return { data, metaPagination };
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor<unknown, ApiEnvelope> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiEnvelope> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) return next.handle() as Observable<any>;

    return next.handle().pipe(
      map((payload): ApiEnvelope => {
        const { data, metaPagination } = splitPayload(payload);
        const meta: ApiMeta = {
          timestamp: new Date().toISOString(),
          ...metaPagination,
        };
        return { data, meta };
      }),
    );
  }
}
