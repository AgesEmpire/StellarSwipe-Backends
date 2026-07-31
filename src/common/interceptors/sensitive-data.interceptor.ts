import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { redactSensitiveFields } from '../logger/log-redaction';
import { EXPOSE_SENSITIVE_FIELDS_KEY } from '../decorators/expose-sensitive-fields.decorator';

/**
 * SensitiveDataInterceptor
 *
 * Reusable response serialization layer applied consistently across REST
 * controllers and GraphQL resolvers (registered globally, which NestJS
 * threads through both transports).
 *
 * Two independent redaction passes run on every outbound response:
 *
 *  1. Ciphertext stripping (always on, transport-agnostic) — strips fields
 *     whose values look like AES-256-GCM ciphertext (iv:authTag:ciphertext)
 *     so a failed decrypt or a new encrypted column never leaks raw
 *     ciphertext to a client.
 *
 *  2. Sensitive-field-name redaction (default "public" exposure) — reuses
 *     the same field-name rules as log redaction (`common/logger/log-redaction`)
 *     so financial/identity fields (ssn, cardNumber, accountNumber, secret,
 *     apiKey, ...) are redacted/masked by default even if a DTO forgets to
 *     exclude them explicitly. Routes/resolvers that legitimately need the
 *     raw values (admin/compliance tooling) opt out with
 *     `@ExposeSensitiveFields()`, which marks the response as "internal".
 *
 * Apply globally in main.ts or per-controller/route as needed:
 *
 *   app.useGlobalInterceptors(new SensitiveDataInterceptor(app.get(Reflector)));
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

  constructor(@Optional() private readonly reflector?: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const isInternal =
      this.reflector?.getAllAndOverride<boolean>(EXPOSE_SENSITIVE_FIELDS_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? false;

    return next.handle().pipe(
      map((data) => {
        const stripped = this.strip(data);
        return isInternal ? stripped : redactSensitiveFields(stripped);
      }),
    );
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
