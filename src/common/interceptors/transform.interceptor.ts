import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CorrelationIdStore } from '../correlation/correlation-id.store';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly correlationIdStore: CorrelationIdStore) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((data) => {
        const correlationId = this.correlationIdStore.getCorrelationId();
        return {
          success: true,
          correlationId,
          data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
