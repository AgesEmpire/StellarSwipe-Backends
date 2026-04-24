import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  RequestTimeoutException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';

export const REQUEST_TIMEOUT_KEY = 'request_timeout_ms';

/**
 * Decorator to override the default timeout for a specific route.
 * @example @RequestTimeout(60_000) // 60 seconds
 */
export const RequestTimeout = (ms: number) =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  (Reflect as any).metadata(REQUEST_TIMEOUT_KEY, ms);

const DEFAULT_TIMEOUT_MS = 30_000;

@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handlerTimeout = this.reflector.get<number>(
      REQUEST_TIMEOUT_KEY,
      context.getHandler(),
    );
    const classTimeout = this.reflector.get<number>(
      REQUEST_TIMEOUT_KEY,
      context.getClass(),
    );

    const timeoutMs =
      handlerTimeout ?? classTimeout ?? DEFAULT_TIMEOUT_MS;

    return next.handle().pipe(
      timeout(timeoutMs),
      catchError((err: unknown) => {
        if (err instanceof TimeoutError) {
          return throwError(() => new RequestTimeoutException());
        }
        return throwError(() => err);
      }),
    );
  }
}
