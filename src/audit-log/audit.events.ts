export enum AuditEventType {
  // Auth events
  USER_LOGIN = 'audit.user.login',
  USER_LOGOUT = 'audit.user.logout',
  PASSWORD_CHANGED = 'audit.user.password.changed',
  
  // Wallet events
  WALLET_CREATED = 'audit.wallet.created',
  WALLET_UPDATED = 'audit.wallet.updated',
  WALLET_DELETED = 'audit.wallet.deleted',
  
  // Admin events
  ADMIN_OVERRIDE = 'audit.admin.override',
  ADMIN_USER_CREATED = 'audit.admin.user.created',
  ADMIN_USER_DELETED = 'audit.admin.user.deleted',
  
  // Export events
  EXPORT_REQUESTED = 'audit.export.requested',
  EXPORT_COMPLETED = 'audit.export.completed',
  EXPORT_FAILED = 'audit.export.failed',
  
  // API key events
  API_KEY_CREATED = 'audit.api_key.created',
  API_KEY_ROTATED = 'audit.api_key.rotated',
  API_KEY_REVOKED = 'audit.api_key.revoked',
}

export interface AuditEventPayload {
  userId: string;
  action: AuditEventType;
  resource?: string;
  resourceId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  status?: 'SUCCESS' | 'FAILURE';
  errorMessage?: string;
}
