import { Injectable, Logger, ForbiddenException } from '@nestjs/common';

export interface AuthorizationDenialContext {
  userId?: string;
  tenantId?: string;
  resource: string;
  action: string;
  reason: string;
  requestId?: string;
}

/**
 * Provides structured audit logging and descriptive errors for authorization
 * denials, so security teams and developers can troubleshoot access issues
 * without digging through generic 403 responses.
 */
@Injectable()
export class AuthorizationDenialLoggerService {
  private readonly logger = new Logger('AuthorizationDenial');

  logAndThrow(context: AuthorizationDenialContext): never {
    this.logger.warn({
      event: 'authorization_denied',
      userId: context.userId ?? 'anonymous',
      tenantId: context.tenantId ?? 'unknown',
      resource: context.resource,
      action: context.action,
      reason: context.reason,
      requestId: context.requestId,
      timestamp: new Date().toISOString(),
    });

    throw new ForbiddenException({
      message: `Access denied: not authorized to ${context.action} ${context.resource}`,
      reason: context.reason,
      requestId: context.requestId,
    });
  }

  log(context: AuthorizationDenialContext): void {
    this.logger.warn({
      event: 'authorization_denied',
      userId: context.userId ?? 'anonymous',
      tenantId: context.tenantId ?? 'unknown',
      resource: context.resource,
      action: context.action,
      reason: context.reason,
      requestId: context.requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
