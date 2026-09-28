import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEvent } from './audit-event.entity';

/**
 * Centrally maintained policy of field names whose values must never be
 * persisted in audit storage. Matching is case-insensitive and applies to
 * request, entity, and metadata payloads at any nesting depth.
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
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'cookie',
  'set-cookie',
  'sessionid',
  'session_id',
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

/**
 * Returns true when the given field name is covered by the redaction policy.
 */
export function isSensitiveAuditField(field: string): boolean {
  return SENSITIVE_FIELD_SET.has(field.toLowerCase());
}

/**
 * Recursively redacts sensitive fields from arbitrary audit payloads.
 * Nested objects and arrays are traversed; primitives are returned as-is.
 */
export function redactAuditPayload<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditPayload(item)) as unknown as T;
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(source)) {
      result[key] = isSensitiveAuditField(key)
        ? REDACTED
        : redactAuditPayload(nested);
    }

    return result as unknown as T;
  }

  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditEvent)
    private readonly auditRepository: Repository<AuditEvent>,
  ) {}

  /**
   * Persists an audit event after applying the redaction policy to the
   * request, entity, and metadata payloads.
   */
  async record(event: Partial<AuditEvent>): Promise<AuditEvent> {
    const sanitized: Partial<AuditEvent> = {
      ...event,
      request: redactAuditPayload(event.request),
      entity: redactAuditPayload(event.entity),
      metadata: redactAuditPayload(event.metadata),
    };

    const saved = await this.auditRepository.save(
      this.auditRepository.create(sanitized),
    );

    this.logger.debug(`Recorded audit event ${saved.id}`);
    return saved;
  }

  async findAll(): Promise<AuditEvent[]> {
    return this.auditRepository.find();
  }
}
