import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AuditAction,
  AuditStatus,
} from '../../audit-log/entities/audit-log.entity';
import { AuditService } from '../../audit-log/audit.service';
import {
  AssignmentStatus,
  UserRole,
} from '../../authorization/entities/user-role.entity';
import { InvalidateSessionDto } from './dto/invalidate-session.dto';
import { SessionManagerService } from './session-manager.service';

export interface SessionInvalidationActor {
  userId?: string;
  id?: string;
  username?: string;
  role?: string;
  roles?: string[];
  isAdmin?: boolean;
}

export interface SessionInvalidationRequestContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface SessionInvalidationResult {
  invalidated: boolean;
  targetUserId?: string;
  targetSessionId?: string;
  invalidatedSessionIds: string[];
  auditId?: string;
}

@Injectable()
export class SessionInvalidationService {
  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly auditService: AuditService,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
  ) {}

  async invalidate(
    dto: InvalidateSessionDto,
    actor: SessionInvalidationActor | undefined,
    context: SessionInvalidationRequestContext = {},
  ): Promise<SessionInvalidationResult> {
    const actorUserId = await this.assertAdmin(actor);
    const reason = dto.reason?.trim() || 'admin_session_invalidation';

    if (dto.sessionId) {
      const session = await this.sessionManager.getSession(dto.sessionId);
      if (!session) {
        throw new NotFoundException('Session not found or already invalidated');
      }

      await this.sessionManager.deleteSession(dto.sessionId);
      const audit = await this.auditService.log({
        action: AuditAction.SESSION_INVALIDATED,
        userId: actorUserId,
        resource: 'auth-session',
        resourceId: dto.sessionId,
        sessionId: dto.sessionId,
        status: AuditStatus.SUCCESS,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        requestId: context.requestId,
        metadata: {
          mode: 'session',
          reason,
          targetUserId: session.userId,
          invalidatedSessionIds: [dto.sessionId],
        },
      });

      return {
        invalidated: true,
        targetUserId: session.userId,
        targetSessionId: dto.sessionId,
        invalidatedSessionIds: [dto.sessionId],
        auditId: audit.id,
      };
    }

    if (!dto.userId) {
      throw new NotFoundException('Session ID or user ID is required');
    }

    const sessionIds = await this.sessionManager.getUserSessions(dto.userId);
    await this.sessionManager.deleteAllUserSessions(dto.userId);
    const audit = await this.auditService.log({
      action: AuditAction.SESSION_INVALIDATED,
      userId: actorUserId,
      resource: 'auth-user-sessions',
      resourceId: dto.userId,
      status: AuditStatus.SUCCESS,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
      metadata: {
        mode: 'user',
        reason,
        targetUserId: dto.userId,
        invalidatedSessionIds: sessionIds,
      },
    });

    return {
      invalidated: true,
      targetUserId: dto.userId,
      invalidatedSessionIds: sessionIds,
      auditId: audit.id,
    };
  }

  private async assertAdmin(
    actor: SessionInvalidationActor | undefined,
  ): Promise<string> {
    const actorUserId = actor?.id ?? actor?.userId;
    if (!actorUserId) {
      throw new ForbiddenException('Admin access is required');
    }

    const inlineRoles = new Set([
      actor.role?.toLowerCase(),
      ...(actor.roles ?? []).map((role) => role.toLowerCase()),
    ]);

    if (
      actor.isAdmin ||
      inlineRoles.has('admin') ||
      inlineRoles.has('administrator')
    ) {
      return actorUserId;
    }

    const roleAssignments = await this.userRoleRepository.find({
      where: { userId: actorUserId, status: AssignmentStatus.ACTIVE },
      relations: ['role'],
    });

    const hasAdminRole = roleAssignments.some((assignment) => {
      const isActive =
        typeof assignment.isActive === 'function'
          ? assignment.isActive()
          : assignment.status === AssignmentStatus.ACTIVE &&
            (!assignment.expiresAt || assignment.expiresAt > new Date());
      const roleName = assignment.role?.name?.toLowerCase();

      return isActive && (roleName === 'admin' || roleName === 'administrator');
    });

    if (hasAdminRole) {
      return actorUserId;
    }

    throw new ForbiddenException('Admin access is required');
  }
}
