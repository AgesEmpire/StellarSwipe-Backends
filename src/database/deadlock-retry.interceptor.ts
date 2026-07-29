import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, mergeMap, retryWhen } from 'rxjs/operators';

/** PostgreSQL error codes that are safe to retry */
const RETRYABLE_PG_CODES = new Set([
  '40P01', // deadlock_detected
  '40001', // serialization_failure
]);

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;

function isRetryableError(error: any): boolean {
  return (
    RETRYABLE_PG_CODES.has(error?.code) ||
    RETRYABLE_PG_CODES.has(error?.driverError?.code)
  );
}

@Injectable()
export class DeadlockRetryInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DeadlockRetryInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      retryWhen((errors) =>
        errors.pipe(
          mergeMap((error, attempt) => {
            if (attempt >= MAX_RETRIES || !isRetryableError(error)) {
              return throwError(() => error);
            }

            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            this.logger.warn(
              `Retryable DB error (${error?.code ?? error?.driverError?.code}), ` +
                `attempt ${attempt + 1}/${MAX_RETRIES}, retrying in ${delay}ms`,
            );
            return timer(delay);
          }),
        ),
      ),
      catchError((error) => throwError(() => error)),
    );
  }
}
