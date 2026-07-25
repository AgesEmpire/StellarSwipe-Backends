import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { HttpException } from '@nestjs/common';
import { RetryAfterService } from '../services/retry-after.service';

@Injectable()
export class RetryAfterInterceptor implements NestInterceptor {
  constructor(private readonly retryAfterService: RetryAfterService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError((error) => {
        if (
          error instanceof HttpException &&
          error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
        ) {
          const response = context.switchToHttp().getResponse();

          if (!response.hasHeader('Retry-After')) {
            const retryAfter = this.getRetryAfterFromError(error);
            if (retryAfter !== null) {
              response.setHeader('Retry-After', retryAfter);
            }
          }
        }

        throw error;
      }),
    );
  }

  private getRetryAfterFromError(error: HttpException): string | null {
    const response = error.getResponse();

    if (typeof response === 'object' && response !== null) {
      const obj = response as any;

      if (obj.retryAfter !== undefined) {
        return String(obj.retryAfter);
      }

      if (obj.resetTime !== undefined) {
        return this.retryAfterService.fromResetTimestamp(obj.resetTime);
      }
    }

    return null;
  }
}
