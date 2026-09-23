import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuditInterceptor } from './audit.interceptor';

/**
 * Central, maintainable policy of field names whose values must never be
 * persisted to audit storage. Matching is case-insensitive and applies to
 * request, entity, and metadata fields at any nesting depth.
 */
export const SENSITIVE_AUDIT_FIELDS: readonly string[] = [
  // Credentials
  'password',
  'passwd',
  'pwd',
  'secret',
  'clientsecret',
  'client_secret',
  'privatekey',
  'private_key',
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  // Tokens
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'idtoken',
  'id_token',
  'bearertoken',
  'bearer_token',
  'authorization',
  'auth',
  'cookie',
  'set-cookie',
  'session',
  'sessionid',
  'session_id',
  'csrf',
  'csrftoken',
  'csrf_token',
  'xsrf',
  'xsrf-token',
  // Sensitive headers
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-refresh-token',
  'x-csrf-token',
  'x-xsrf-token',
  'proxy-authorization',
];

const REDACTED = '[REDACTED]';

const SENSITIVE_FIELD_SET = new Set(
  SENSITIVE_AUDIT_FIELDS.map((field) => field.toLowerCase()),
);

function isSensitiveField(key: string): boolean {
  return SENSITIVE_FIELD_SET.has(key.toLowerCase());
}

/**
 * Recursively redacts sensitive fields from an audit payload. Nested objects
 * and arrays are traversed so secrets never reach audit storage regardless of
 * where they appear in the event shape.
 */
export function redactAuditPayload<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditPayload(item)) as unknown as T;
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const key of Object.keys(source)) {
      if (isSensitiveField(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = redactAuditPayload(source[key]);
      }
    }

    return result as unknown as T;
  }

  return value;
}

@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
