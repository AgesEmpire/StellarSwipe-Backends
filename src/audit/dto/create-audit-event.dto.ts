import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * Central, maintainable policy of field names whose values must never be
 * persisted in audit storage. Matching is case-insensitive and applies to
 * request, entity, and metadata payloads, including nested objects/arrays.
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
  'secretkey',
  'secret_key',
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
  'authtoken',
  'auth_token',
  'sessiontoken',
  'session_token',
  'csrf',
  'csrftoken',
  'csrf_token',
  'xsrf',
  'xsrftoken',
  'xsrf_token',
  // Sensitive headers
  'authorization',
  'proxyauthorization',
  'proxy_authorization',
  'cookie',
  'setcookie',
  'set_cookie',
  'xapikey',
  'x_api_key',
  'xauthtoken',
  'x_auth_token',
  'xcsrftoken',
  'x_csrf_token',
  'x-xsrf-token',
  'x-amz-security-token',
];

/** Placeholder written in place of any redacted value. */
export const REDACTED_AUDIT_VALUE = '[REDACTED]';

const SENSITIVE_FIELD_SET = new Set(
  SENSITIVE_AUDIT_FIELDS.map((field) => field.toLowerCase()),
);

/**
 * Returns true when the given field name is covered by the redaction policy.
 */
export function isSensitiveAuditField(field: string): boolean {
  return SENSITIVE_FIELD_SET.has(field.toLowerCase());
}

/**
 * Recursively redacts sensitive fields from an arbitrary value. Nested objects
 * and arrays are traversed so secrets never reach audit storage at any depth.
 */
export function redactAuditValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(item)) as unknown as T;
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(source)) {
      result[key] = isSensitiveAuditField(key)
        ? REDACTED_AUDIT_VALUE
        : redactAuditValue(nested);
    }

    return result as unknown as T;
  }

  return value;
}

export class AuditEventRequestDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  headers?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  query?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  body?: Record<string, unknown>;
}

export class AuditEventEntityDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class CreateAuditEventDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  timestamp?: string;

  @ApiPropertyOptional({ type: () => AuditEventRequestDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AuditEventRequestDto)
  request?: AuditEventRequestDto;

  @ApiPropertyOptional({ type: () => AuditEventEntityDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AuditEventEntityDto)
  entity?: AuditEventEntityDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  tags?: string[];

  /**
   * Applies the central redaction policy to every field that may carry secrets
   * or personal data before the event is persisted.
   */
  redact(): this {
    if (this.request) {
      this.request = redactAuditValue(this.request);
    }

    if (this.entity) {
      this.entity = redactAuditValue(this.entity);
    }

    if (this.metadata) {
      this.metadata = redactAuditValue(this.metadata);
    }

    return this;
  }
}
