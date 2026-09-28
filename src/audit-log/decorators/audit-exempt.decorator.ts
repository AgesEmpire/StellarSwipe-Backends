import { SetMetadata } from '@nestjs/common';

export const AUDIT_EXEMPT_KEY = 'auditExempt';

export const AuditExempt = () => SetMetadata(AUDIT_EXEMPT_KEY, true);
