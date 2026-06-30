import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { getInternalFields } from '../decorators/internal.decorator';

/**
 * Global interceptor that strips fields marked with @Internal() decorator
 * from all API responses. Works with single objects, arrays, and nested structures.
 */
@Injectable()
export class StripInternalFieldsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      map((payload) => this.stripInternalFields(payload)),
    );
  }

  /**
   * Recursively removes all fields marked as @Internal() from payload.
   *
   * @param payload The response payload to process.
   * @returns The payload with internal fields removed.
   */
  private stripInternalFields(payload: any): any {
    if (payload === null || payload === undefined) {
      return payload;
    }

    if (Array.isArray(payload)) {
      return payload.map((item) => this.stripInternalFields(item));
    }

    if (typeof payload !== 'object') {
      return payload;
    }

    // Handle plain objects and class instances
    const internalFields = getInternalFields(payload);

    if (internalFields.length === 0) {
      // No internal fields to strip, but still process nested properties
      const stripped: any = {};
      for (const [key, value] of Object.entries(payload)) {
        stripped[key] = this.stripInternalFields(value);
      }
      return stripped;
    }

    // Clone the object and remove internal fields
    const stripped: any = {};
    for (const [key, value] of Object.entries(payload)) {
      if (!internalFields.includes(key)) {
        stripped[key] = this.stripInternalFields(value);
      }
    }

    return stripped;
  }
}
