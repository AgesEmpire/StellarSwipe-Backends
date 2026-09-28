import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, createHmac } from 'crypto';
import { DataSource } from 'typeorm';
import { AuditAction, AuditLog, AuditStatus } from '../audit-log.entity';

export interface SecurityAuditEvent {
  actorId: string | null;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  outcome: AuditStatus;
  correlationId?: string | null;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}

const REDACT = /pass|secret|token|key|mnemonic|seed|pin|cvv|ssn/i;
const HMAC_KEY = process.env.AUDIT_HMAC_KEY ?? '';

/** Key-sorted JSON so hashes survive jsonb key reordering. */
const canonical = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(',')}}`
      : JSON.stringify(v ?? null);

/**
 * Tamper-evident security audit writer. Each record stores the hash of the
 * previous record plus its own hash (HMAC when AUDIT_HMAC_KEY is set), so any
 * edit/removal breaks the chain and is detected by `verifyChain`.
 * Unlike AuditService.log, failures are thrown so callers cannot silently skip.
 */
@Injectable()
export class SecurityAuditService {
  private readonly logger = new Logger(SecurityAuditService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async record(event: SecurityAuditEvent): Promise<AuditLog> {
    try {
      return await this.dataSource.transaction('SERIALIZABLE', async (manager) => {
        const repo = manager.getRepository(AuditLog);
        const [prev] = await repo
          .createQueryBuilder('a')
          .where("a.metadata ? 'chainHash'")
          .orderBy('a.created_at', 'DESC')
          .addOrderBy('a.id', 'DESC')
          .limit(1)
          .getMany();
        const prevHash = (prev?.metadata?.chainHash as string) ?? 'GENESIS';

        const body = {
          actorId: event.actorId,
          action: event.action,
          targetType: event.targetType,
          targetId: event.targetId ?? null,
          outcome: event.outcome,
          correlationId: event.correlationId ?? null,
          details: this.redact(event.metadata ?? {}),
          recordedAt: new Date().toISOString(),
        };
        const chainHash = this.hash(prevHash, body);

        return repo.save(
          repo.create({
            userId: event.actorId ?? undefined,
            action: event.action,
            resource: event.targetType,
            resourceId: event.targetId ?? undefined,
            status: event.outcome,
            requestId: event.correlationId ?? undefined,
            ipAddress: event.ipAddress,
            userAgent: event.userAgent,
            errorMessage: event.errorMessage,
            metadata: { security: true, ...body, prevHash, chainHash },
          }),
        );
      });
    } catch (err) {
      this.logger.error(`Security audit write failed for ${event.action}`, (err as Error).stack);
      throw new InternalServerErrorException('Audit trail unavailable');
    }
  }

  /** Query security audit records by actor/target/action/correlation ID. */
  query(filter: { actorId?: string; targetId?: string; action?: AuditAction; correlationId?: string; limit?: number }) {
    const qb = this.dataSource
      .getRepository(AuditLog)
      .createQueryBuilder('a')
      .where("a.metadata ->> 'security' = 'true'");
    if (filter.actorId) qb.andWhere('a.user_id = :actorId', { actorId: filter.actorId });
    if (filter.targetId) qb.andWhere('a.resource_id = :targetId', { targetId: filter.targetId });
    if (filter.action) qb.andWhere('a.action = :action', { action: filter.action });
    if (filter.correlationId) qb.andWhere('a.request_id = :cid', { cid: filter.correlationId });
    return qb.orderBy('a.created_at', 'DESC').take(Math.min(filter.limit ?? 50, 500)).getMany();
  }

  /** Recomputes the hash chain; returns the first broken record id, if any. */
  async verifyChain(): Promise<{ valid: boolean; brokenAt?: string }> {
    const rows = await this.dataSource
      .getRepository(AuditLog)
      .createQueryBuilder('a')
      .where("a.metadata ? 'chainHash'")
      .orderBy('a.created_at', 'ASC')
      .addOrderBy('a.id', 'ASC')
      .getMany();
    let prevHash = 'GENESIS';
    for (const row of rows) {
      const { prevHash: storedPrev, chainHash, security, ...body } = row.metadata as any;
      if (storedPrev !== prevHash || this.hash(prevHash, body) !== chainHash) {
        return { valid: false, brokenAt: row.id };
      }
      prevHash = chainHash;
    }
    return { valid: true };
  }

  private hash(prevHash: string, body: Record<string, unknown>): string {
    const input = prevHash + canonical(body);
    return HMAC_KEY
      ? createHmac('sha256', HMAC_KEY).update(input).digest('hex')
      : createHash('sha256').update(input).digest('hex');
  }

  private redact(obj: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [
        k,
        REDACT.test(k)
          ? '[REDACTED]'
          : v && typeof v === 'object' && !Array.isArray(v)
            ? this.redact(v as Record<string, unknown>)
            : v,
      ]),
    );
  }
}
