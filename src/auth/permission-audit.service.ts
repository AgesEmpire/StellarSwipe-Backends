import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere } from 'typeorm';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

// ---------------------------------------------------------------------------
// Audit log entity (inline – no separate file needed per issue scope)
// ---------------------------------------------------------------------------

export enum AuditAction {
  ROLE_ASSIGNED = 'role_assigned',
  ROLE_REVOKED = 'role_revoked',
  PERMISSION_GRANTED = 'permission_granted',
  PERMISSION_REVOKED = 'permission_revoked',
  ROLE_CREATED = 'role_created',
  ROLE_UPDATED = 'role_updated',
  ROLE_DELETED = 'role_deleted',
}

@Entity('permission_audit_logs')
@Index(['actorId'])
@Index(['targetUserId'])
@Index(['action'])
@Index(['createdAt'])
export class PermissionAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The user who performed the change */
  @Column({ type: 'uuid' })
  actorId: string;

  /** The user whose permissions were modified (may equal actorId for self-service) */
  @Column({ type: 'uuid', nullable: true })
  targetUserId: string;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  /** Role or permission name that was affected */
  @Column({ type: 'varchar', length: 255 })
  resourceName: string;

  /** Optional free-form context (role id, permission ids, reason, etc.) */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface LogPermissionChangeDto {
  actorId: string;
  targetUserId?: string;
  action: AuditAction;
  resourceName: string;
  metadata?: Record<string, unknown>;
}

export interface AuditQueryDto {
  actorId?: string;
  targetUserId?: string;
  action?: AuditAction;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class PermissionAuditService {
  private readonly logger = new Logger(PermissionAuditService.name);

  constructor(
    @InjectRepository(PermissionAuditLog)
    private readonly auditRepository: Repository<PermissionAuditLog>,
  ) {}

  /**
   * Record a single RBAC / permission change event.
   */
  async log(dto: LogPermissionChangeDto): Promise<PermissionAuditLog> {
    const entry = this.auditRepository.create({
      actorId: dto.actorId,
      targetUserId: dto.targetUserId ?? dto.actorId,
      action: dto.action,
      resourceName: dto.resourceName,
      metadata: dto.metadata ?? {},
    });

    const saved = await this.auditRepository.save(entry);
    this.logger.log(
      `[AUDIT] ${dto.action} by ${dto.actorId} on ${dto.resourceName}` +
        (dto.targetUserId ? ` for user ${dto.targetUserId}` : ''),
    );
    return saved;
  }

  /**
   * Query audit logs with optional filters.
   */
  async query(
    dto: AuditQueryDto,
  ): Promise<{ data: PermissionAuditLog[]; total: number }> {
    const where: FindOptionsWhere<PermissionAuditLog> = {};

    if (dto.actorId) where.actorId = dto.actorId;
    if (dto.targetUserId) where.targetUserId = dto.targetUserId;
    if (dto.action) where.action = dto.action;
    if (dto.from && dto.to) {
      where.createdAt = Between(dto.from, dto.to);
    }

    const [data, total] = await this.auditRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: dto.limit ?? 50,
      skip: dto.offset ?? 0,
    });

    return { data, total };
  }

  /**
   * Retrieve the full audit trail for a specific user.
   */
  async getTrailForUser(userId: string): Promise<PermissionAuditLog[]> {
    return this.auditRepository.find({
      where: { targetUserId: userId },
      order: { createdAt: 'DESC' },
    });
  }
}
