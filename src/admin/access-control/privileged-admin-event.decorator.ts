import { SetMetadata } from '@nestjs/common';
import { AuditAction } from '../../audit-log/entities/audit-log.entity';

export const PRIVILEGED_ADMIN_EVENT_KEY = 'privilegedAdminEvent';

export interface PrivilegedAdminEventOptions {
  /** Audit action recorded for this endpoint (from the existing AuditAction enum). */
  action: AuditAction;
  /** Logical resource this privileged action affects, e.g. "user", "payout". */
  resource: string;
}

/**
 * Marks a controller method as a privileged admin action so
 * PrivilegedAdminAuditInterceptor captures actor identity, IP, timestamp
 * and payload metadata for it — required for compliance/investigation and
 * rollback workflows.
 *
 * Usage:
 *   @PrivilegedAdminEvent({ action: AuditAction.ADMIN_USER_DELETED, resource: 'user' })
 *   @Delete(':id')
 *   deleteUser(...) { ... }
 */
export const PrivilegedAdminEvent = (options: PrivilegedAdminEventOptions) =>
  SetMetadata(PRIVILEGED_ADMIN_EVENT_KEY, options);
