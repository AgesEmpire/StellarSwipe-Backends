import { SetMetadata } from '@nestjs/common';
import { AuditAction } from '../audit-log.entity';

export const SECURITY_AUDIT_KEY = 'security_audit';

export interface SecurityAuditOptions {
  action: AuditAction;
  targetType: string;
  /** Route param holding the target id (defaults to `id`). */
  targetParam?: string;
}

/** Marks a handler as security-sensitive; SecurityAuditInterceptor records every outcome. */
export const SecurityAudit = (options: SecurityAuditOptions) =>
  SetMetadata(SECURITY_AUDIT_KEY, options);
