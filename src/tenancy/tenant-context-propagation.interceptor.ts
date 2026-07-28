import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tenantStorage, getCurrentTenantIdOrNull } from './tenant-context';

/**
 * Ensures the active tenant context is carried through request handling
 * even when work is dispatched to handlers that create their own async
 * boundaries (e.g. schedulers, event emitters, queue producers) so
 * tenant-specific rules cannot be silently bypassed downstream.
 */
@Injectable()
export class TenantContextPropagationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const tenantId =
      getCurrentTenantIdOrNull() ??
      request?.tenantId ??
      request?.headers?.['x-tenant-id'] ??
      null;

    if (!tenantId) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      tenantStorage.run({ tenantId }, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
