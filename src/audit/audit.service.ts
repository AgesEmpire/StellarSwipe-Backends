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

/**
 * Default number of audit events returned when no page size is supplied.
 */
export const DEFAULT_AUDIT_PAGE_SIZE = 25;

/**
 * Hard upper bound on the number of audit events returned per page. Requests
 * asking for more are clamped to this value so a single query can never scan
 * an unbounded slice of the audit trail.
 */
export const MAX_AUDIT_PAGE_SIZE = 100;

/**
 * A single page of audit history plus the cursor needed to fetch the next one.
 */
export interface AuditPage {
  items: AuditEvent[];
  /** Cursor to pass as `cursor` for the next page, or null when exhausted. */
  nextCursor: string | null;
  /** True when no further pages exist after this one. */
  hasMore: boolean;
}

/**
 * Opaque, deterministic cursor over the audit trail. Ordering is by
 * `createdAt` descending with `id` descending as a stable tie-breaker, so the
 * cursor only needs to carry the last row's sort key.
 */
interface AuditCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(event: AuditEvent): string {
  const payload: AuditCursor = {
    createdAt: new Date(event.createdAt).toISOString(),
    id: String(event.id),
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): AuditCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid audit cursor');
  }

  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof (parsed as AuditCursor).createdAt !== 'string' ||
    typeof (parsed as AuditCursor).id !== 'string' ||
    Number.isNaN(Date.parse((parsed as AuditCursor).createdAt))
  ) {
    throw new Error('Invalid audit cursor');
  }

  return parsed as AuditCursor;
}

/**
 * Normalizes a requested page size into the supported [1, MAX] range.
 * Non-finite, non-positive, or oversized values are bounded rather than
 * allowed to reach the database.
 */
function normalizePageSize(limit?: number): number {
  if (limit === undefined || limit === null || !Number.isFinite(limit)) {
    return DEFAULT_AUDIT_PAGE_SIZE;
  }

  const floored = Math.floor(limit);
  if (floored < 1) {
    return DEFAULT_AUDIT_PAGE_SIZE;
  }

  return Math.min(floored, MAX_AUDIT_PAGE_SIZE);
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

  /**
   * Returns a bounded, deterministically ordered page of audit history.
   *
   * Ordering is `createdAt DESC, id DESC`; the returned cursor encodes the
   * last row's sort key so subsequent pages are stable even when new events
   * are written concurrently. Oversized page sizes are clamped to
   * {@link MAX_AUDIT_PAGE_SIZE} and malformed cursors are rejected.
   */
  async findPage(options: { limit?: number; cursor?: string } = {}): Promise<AuditPage> {
    const limit = normalizePageSize(options.limit);

    const qb = this.auditRepository
      .createQueryBuilder('audit')
      .orderBy('audit.createdAt', 'DESC')
      .addOrderBy('audit.id', 'DESC')
      // Fetch one extra row to detect whether another page exists.
      .take(limit + 1);

    if (options.cursor) {
      const cursor = decodeCursor(options.cursor);
      qb.where(
        '(audit.createdAt < :createdAt) OR (audit.createdAt = :createdAt AND audit.id < :id)',
        { createdAt: cursor.createdAt, id: cursor.id },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && items.length > 0 ? encodeCursor(items[items.length - 1]) : null;

    return { items, nextCursor, hasMore };
  }
}
