import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditAction, AuditStatus } from '../../../audit-log/audit-log.entity';
import { SessionManagerService } from './session-manager.service';
import {
  InvalidateSessionDto,
  InvalidateSessionResponseDto,
} from './dto/invalidate-session.dto';

@Injectable()
export class SessionInvalidationService {
  private readonly logger = new Logger(SessionInvalidationService.name);

  constructor(
    private readonly sessionManagerService: SessionManagerService,
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async invalidateBySessionId(
    sessionId: string,
    adminId: string,
    reason?: string,
  ): Promise<InvalidateSessionResponseDto> {
    const session = await this.sessionManagerService.getSession(sessionId);
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found or already expired`);
    }

    await this.sessionManagerService.deleteSession(sessionId);

    const entry = this.auditRepo.create({
      userId: session.userId,
      action: AuditAction.SUSPICIOUS_ACTIVITY,
      resource: 'session',
      resourceId: sessionId,
      status: AuditStatus.SUCCESS,
      metadata: { adminId, reason, type: 'session_invalidation' },
    });
    const saved = await this.auditRepo.save(entry);

    this.logger.log(`Session ${sessionId} invalidated by admin ${adminId}`);

    return {
      invalidatedCount: 1,
      sessionIds: [sessionId],
      userId: session.userId,
      auditId: saved.id,
      invalidatedAt: saved.createdAt,
    };
  }

  async invalidateByUserId(
    userId: string,
    adminId: string,
    reason?: string,
  ): Promise<InvalidateSessionResponseDto> {
    const sessions = await this.sessionManagerService.getUserSessions(userId);

    await this.sessionManagerService.deleteAllUserSessions(userId);

    const entry = this.auditRepo.create({
      userId,
      action: AuditAction.SUSPICIOUS_ACTIVITY,
      resource: 'session',
      resourceId: userId,
      status: AuditStatus.SUCCESS,
      metadata: {
        adminId,
        reason,
        sessionCount: sessions.length,
        type: 'bulk_session_invalidation',
      },
    });
    const saved = await this.auditRepo.save(entry);

    this.logger.log(
      `All ${sessions.length} sessions for user ${userId} invalidated by admin ${adminId}`,
    );

    return {
      invalidatedCount: sessions.length,
      sessionIds: sessions,
      userId,
      auditId: saved.id,
      invalidatedAt: saved.createdAt,
    };
  }

  async invalidate(dto: InvalidateSessionDto): Promise<InvalidateSessionResponseDto> {
    if (dto.sessionId) {
      return this.invalidateBySessionId(dto.sessionId, dto.adminId, dto.reason);
    }
    if (dto.userId) {
      return this.invalidateByUserId(dto.userId, dto.adminId, dto.reason);
    }
    throw new BadRequestException('Either sessionId or userId must be provided');
  }
}
