import {
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditLog, AuditAction, AuditStatus } from './entities/audit-log.entity';
import { AuditQueryDto, CreateAuditLogDto } from './dto/audit-query.dto';
import { resolveRetentionDays } from '../common/retention/retention.config';

const SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'privateKey',
  'secretKey',
  'mnemonic',
  'seed',
  'pin',
  'cvv',
  'ssn',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiSecret',
];

export interface AuditLogPage {
  data: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  /** Configurable via RETENTION_AUDIT_LOG_DAYS — defaults to 2 years. See docs/guides/retention-policy.md. */
  private readonly RETENTION_DAYS = resolveRetentionDays('auditLogDays');

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  /**
   * Create an immutable audit log entry.
   * Sanitizes sensitive fields before persistence.
   */
  async log(dto: CreateAuditLogDto): Promise<AuditLog> {
    try {
      const sanitizedMetadata = dto.metadata
        ? this.sanitizeMetadata(dto.metadata)
        : undefined;

      const entry = this.auditLogRepository.create({
        ...dto,
        metadata: sanitizedMetadata,
        status: dto.status ?? AuditStatus.SUCCESS,
      });

      return await this.auditLogRepository.save(entry);
    } catch (error) {
      // Never let audit logging failures break application flow
      this.logger.error('Failed to write audit log', {
        action: dto.action,
        userId: dto.userId,
        error: (error as Error).message,
      });
      // Return a partial object so callers aren't broken
      return { id: 'error', ...dto, createdAt: new Date() } as AuditLog;
    }
  }

  /**
   * Query audit logs with filtering and pagination.
   */
  async query(dto: AuditQueryDto): Promise<AuditLogPage> {
    const { page = 1, limit = 50, startDate, endDate, ...filters } = dto;
    const skip = (page - 1) * limit;

    const where: FindOptionsWhere<AuditLog> = {};

    if (filters.userId) where.userId = filters.userId;
    if (filters.action) where.action = filters.action;
    if (filters.status) where.status = filters.status;
    if (filters.resource) where.resource = filters.resource;
    if (filters.resourceId) where.resourceId = filters.resourceId;
    if (filters.ipAddress) where.ipAddress = filters.ipAddress;

    if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : new Date(0);
      const end = endDate ? new Date(endDate) : new Date();
      where.createdAt = Between(start, end);
    }

    const [data, total] = await this.auditLogRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a single audit log entry by ID.
   */
  async findById(id: string): Promise<AuditLog | null> {
    return this.auditLogRepository.findOne({ where: { id } });
  }

  /**
   * Get audit trail for a specific user.
   */
  async getUserAuditTrail(userId: string, limit = 100): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get audit trail for a specific resource.
   */
  async getResourceAuditTrail(
    resource: string,
    resourceId: string,
    limit = 100,
  ): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { resource, resourceId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Count events by action within a time range (for analytics/compliance).
   */
  async countByAction(
    action: AuditAction,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    return this.auditLogRepository.count({
      where: {
        action,
        createdAt: Between(startDate, endDate),
      },
    });
  }

  /**
   * Detect suspicious activity: multiple failed logins from same IP.
   */
  async detectSuspiciousActivity(
    ipAddress: string,
    windowMinutes = 15,
    threshold = 5,
  ): Promise<boolean> {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);
    const failedAttempts = await this.auditLogRepository.count({
      where: {
        action: AuditAction.LOGIN_FAILED,
        ipAddress,
        createdAt: Between(since, new Date()),
      },
    });
    return failedAttempts >= threshold;
  }

  /**
   * Scheduled retention cleanup — runs nightly at 2 AM.
   * Removes logs older than 2 years.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async enforceRetentionPolicy(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.RETENTION_DAYS);

    try {
      // Use raw query to bypass the BeforeRemove hook (intentional system deletion)
      const result = await this.auditLogRepository
        .createQueryBuilder()
        .delete()
        .from(AuditLog)
        .where('created_at < :cutoffDate', { cutoffDate })
        .execute();

      this.logger.log(
        `Retention policy: deleted ${result.affected} audit logs older than ${this.RETENTION_DAYS} days`,
      );
    } catch (error) {
      this.logger.error('Retention policy cleanup failed', (error as Error).message);
    }
  }

  /**
   * Compliance export — returns logs in a structured format for auditors.
   */
  async exportForCompliance(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: {
        userId,
        createdAt: Between(startDate, endDate),
      },
      order: { createdAt: 'ASC' },
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private sanitizeMetadata(
    metadata: Record<string, any>,
    depth = 0,
  ): Record<string, any> {
    if (depth > 5) return {}; // prevent infinite recursion on deep objects
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (SENSITIVE_FIELDS.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        sanitized[key] = this.sanitizeMetadata(value, depth + 1);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
