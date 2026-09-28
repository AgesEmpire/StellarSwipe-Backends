import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditService } from './audit.service';
import { AuditEventType, AuditEventPayload } from './audit.events';
import { CreateAuditLogDto } from './dto/audit-query.dto';
import { AuditAction } from './entities/audit-log.entity';

@Injectable()
export class AuditEventListener {
  private readonly logger = new Logger(AuditEventListener.name);

  constructor(private readonly auditService: AuditService) {}

  /**
   * Listen to all audit events and persist them
   */
  @OnEvent('audit.*')
  async handleAuditEvent(payload: AuditEventPayload) {
    const dto: CreateAuditLogDto = {
      userId: payload.userId,
      action: this.mapEventTypeToAction(payload.action),
      resource: payload.resource,
      resourceId: payload.resourceId,
      metadata: payload.metadata,
      ipAddress: payload.ipAddress,
      userAgent: payload.userAgent,
      status: payload.status || 'SUCCESS',
      errorMessage: payload.errorMessage,
    };

    try {
      await this.auditService.log(dto);
    } catch (error) {
      this.logger.error(`Failed to handle audit event: ${payload.action}`, error);
    }
  }

  /**
   * Map event types to audit actions
   */
  private mapEventTypeToAction(eventType: AuditEventType): AuditAction {
    const actionMap: Record<AuditEventType, AuditAction> = {
      [AuditEventType.USER_LOGIN]: AuditAction.LOGIN,
      [AuditEventType.USER_LOGOUT]: AuditAction.LOGOUT,
      [AuditEventType.PASSWORD_CHANGED]: AuditAction.PASSWORD_CHANGED,
      [AuditEventType.WALLET_CREATED]: AuditAction.WALLET_CREATED,
      [AuditEventType.WALLET_UPDATED]: AuditAction.WALLET_UPDATED,
      [AuditEventType.WALLET_DELETED]: AuditAction.WALLET_DELETED,
      [AuditEventType.ADMIN_OVERRIDE]: AuditAction.ADMIN_OVERRIDE,
      [AuditEventType.ADMIN_USER_CREATED]: AuditAction.ADMIN_USER_CREATED,
      [AuditEventType.ADMIN_USER_DELETED]: AuditAction.ADMIN_USER_DELETED,
      [AuditEventType.EXPORT_REQUESTED]: AuditAction.DATA_EXPORT_REQUESTED,
      [AuditEventType.EXPORT_COMPLETED]: AuditAction.DATA_EXPORT_COMPLETED,
      [AuditEventType.EXPORT_FAILED]: AuditAction.DATA_EXPORT_FAILED,
      [AuditEventType.API_KEY_CREATED]: AuditAction.API_KEY_CREATED,
      [AuditEventType.API_KEY_ROTATED]: AuditAction.API_KEY_ROTATED,
      [AuditEventType.API_KEY_REVOKED]: AuditAction.API_KEY_REVOKED,
    };

    return actionMap[eventType] || AuditAction.UNKNOWN;
  }
}
