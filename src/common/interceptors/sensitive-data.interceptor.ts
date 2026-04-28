import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * SensitiveDataInterceptor
 *
 * Strips fields whose values look like AES-256-GCM ciphertext
 * (iv:authTag:ciphertext — three colon-delimited hex segments) from outbound
 * API responses.  This prevents raw encrypted values from leaking to clients
 * in the event a transformer fails to decrypt or a new encrypted column is
 * added without a corresponding DTO exclusion.
 *
 * The interceptor walks the response object recursively and replaces any
 * matching string value with `undefined` (which JSON.stringify omits).
 *
 * Apply globally in main.ts or per-controller/route as needed:
 *
 *   app.useGlobalInterceptors(new SensitiveDataInterceptor());
 */
@Injectable()
export class SensitiveDataInterceptor implements NestInterceptor {
  /**
   * Matches the iv:authTag:ciphertext format produced by EncryptionService:
   *   - iv:      24 hex chars (12-byte IV)
   *   - authTag: 32 hex chars (16-byte GCM tag)
   *   - data:    1+ hex chars
   */
  private static readonly CIPHERTEXT_RE =
    /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i;

  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map((data) => this.strip(data)));
  }

  private strip(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
      return SensitiveDataInterceptor.CIPHERTEXT_RE.test(value)
        ? undefined
        : value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.strip(item));
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const stripped = this.strip(v);
        if (stripped !== undefined) {
          result[k] = stripped;
        }
      }
      return result;
    }

    return value;
  }
}
