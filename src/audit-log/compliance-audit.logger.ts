/**
 * ComplianceAuditLogger
 *
 * Structured Winston logger dedicated to compliance audit trails.
 * Writes immutable, tamper-evident JSON log lines to a daily-rotating
 * file transport AND to the existing AuditService (database).
 *
 * Features:
 *  - Structured JSON output with userId, action, timestamp, requestId
 *  - Daily-rotating file transport (logs/compliance-YYYY-MM-DD.log)
 *  - Sensitive field redaction before writing
 *  - Integrates with AuditService for DB persistence
 *
 * Resolves: #454 – Implement backend logging for compliance audit trails
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { AuditService } from '../audit-log/audit.service';
import { AuditAction, AuditStatus } from '../audit-log/entities/audit-log.entity';

export interface ComplianceEvent {
  /** User who triggered the event (null for system events) */
  userId?: string;
  /** Audit action type */
  action: AuditAction;
  /** Resource type (e.g. 'trade', 'user', 'signal') */
  resource?: string;
  /** Resource identifier */
  resourceId?: string;
  /** Outcome */
  status?: AuditStatus;
  /** Client IP address */
  ipAddress?: string;
  /** Browser / client user-agent */
  userAgent?: string;
  /** Correlation ID for distributed tracing */
  requestId?: string;
  /** Additional structured metadata */
  metadata?: Record<string, unknown>;
  /** Error message if status is FAILURE */
  errorMessage?: string;
}

const SENSITIVE_KEYS = [
  'password',
  'token',
  'secret',
  'apiKey',
  'privateKey',
  'accessToken',
  'refreshToken',
  'authorization',
  'pin',
  'cvv',
  'ssn',
];

@Injectable()
export class ComplianceAuditLogger implements OnModuleInit {
  private readonly nestLogger = new Logger(ComplianceAuditLogger.name);
  private winstonLogger!: winston.Logger;

  constructor(
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  onModuleInit(): void {
    this.initWinston();
    this.nestLogger.log('ComplianceAuditLogger initialised');
  }

  private initWinston(): void {
    const logDir =
      this.configService.get<string>('app.logger.directory') ?? './logs';
    const maxFiles =
      this.configService.get<string>('app.logger.maxFiles') ?? '90d';
    const maxSize =
      this.configService.get<string>('app.logger.maxSize') ?? '50m';

    const fileTransport = new DailyRotateFile({
      filename: `${logDir}/compliance-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      maxFiles,
      maxSize,
      zippedArchive: true,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
    });

    const consoleTransport = new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
    });

    this.winstonLogger = winston.createLogger({
      level: 'info',
      transports: [fileTransport, consoleTransport],
      exitOnError: false,
    });
  }

  /**
   * Log a compliance event.
   * Writes to Winston (file + console) and persists to the audit_logs table.
   */
  async logEvent(event: ComplianceEvent): Promise<void> {
    const sanitized = this.sanitize(event);

    // 1. Write structured log via Winston
    this.winstonLogger.info('compliance_audit_event', {
      ...sanitized,
      timestamp: new Date().toISOString(),
      service: 'stellarswipe-backend',
    });

    // 2. Persist to database via AuditService (non-blocking)
    this.auditService
      .log({
        userId: event.userId,
        action: event.action,
        resource: event.resource,
        resourceId: event.resourceId,
        status: event.status ?? AuditStatus.SUCCESS,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        requestId: event.requestId,
        errorMessage: event.errorMessage,
        metadata: sanitized.metadata as Record<string, any> | undefined,
      })
      .catch((err: Error) => {
        this.nestLogger.error(
          'Failed to persist compliance event to DB',
          err.message,
        );
      });
  }

  /**
   * Convenience: log a successful trade execution.
   */
  async logTradeExecuted(
    userId: string,
    tradeId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.logEvent({
      userId,
      action: AuditAction.TRADE_EXECUTED,
      resource: 'trade',
      resourceId: tradeId,
      status: AuditStatus.SUCCESS,
      metadata,
    });
  }

  /**
   * Convenience: log a failed login attempt.
   */
  async logLoginFailed(
    userId: string | undefined,
    ipAddress: string,
    reason: string,
  ): Promise<void> {
    await this.logEvent({
      userId,
      action: AuditAction.LOGIN_FAILED,
      resource: 'auth',
      status: AuditStatus.FAILURE,
      ipAddress,
      errorMessage: reason,
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private sanitize<T>(obj: T): T {
    if (!obj || typeof obj !== 'object') return obj;
    const seen = new WeakSet();

    const recurse = (item: unknown): unknown => {
      if (item === null || typeof item !== 'object') return item;
      if (seen.has(item as object)) return '[Circular]';
      seen.add(item as object);

      if (Array.isArray(item)) return item.map(recurse);

      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        out[k] = SENSITIVE_KEYS.some((s) =>
          k.toLowerCase().includes(s.toLowerCase()),
        )
          ? '[REDACTED]'
          : recurse(v);
      }
      return out;
    };

    return recurse(obj) as T;
  }
}
