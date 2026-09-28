import { Injectable, Logger, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { Request } from 'express';
import { AuditService } from '../audit-log/audit.service';
import { AuditAction, AuditStatus } from '../audit-log/entities/audit-log.entity';

export interface AuthAuditEvent {
  action: AuditAction;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  endpoint: string;
  method: string;
  status: AuditStatus;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Logs authentication events at the endpoint level for security audits.
 * Captures login, logout, failed attempts, and 2FA events with full
 * request context (IP, user-agent, endpoint, outcome).
 */
@Injectable()
export class AuthAuditService {
  private readonly logger = new Logger(AuthAuditService.name);

  constructor(private readonly auditService: AuditService) {}

  async logAuthEvent(event: AuthAuditEvent): Promise<void> {
    try {
      await this.auditService.log({
        userId: event.userId,
        action: event.action,
        resource: 'auth',
        resourceId: event.endpoint,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        status: event.status,
        errorMessage: event.errorMessage,
        metadata: {
          endpoint: event.endpoint,
          method: event.method,
          ...event.metadata,
        },
      });
    } catch (err) {
      // Auth audit must never break the auth flow
      this.logger.error('Failed to write auth audit event', (err as Error).message);
    }
  }

  async logLogin(userId: string, req: Request): Promise<void> {
    await this.logAuthEvent({
      action: AuditAction.LOGIN,
      userId,
      ipAddress: this.extractIp(req),
      userAgent: req.headers['user-agent'],
      endpoint: req.path,
      method: req.method,
      status: AuditStatus.SUCCESS,
    });
  }

  async logLoginFailed(req: Request, reason: string): Promise<void> {
    await this.logAuthEvent({
      action: AuditAction.LOGIN_FAILED,
      ipAddress: this.extractIp(req),
      userAgent: req.headers['user-agent'],
      endpoint: req.path,
      method: req.method,
      status: AuditStatus.FAILURE,
      errorMessage: reason,
    });
  }

  async logLogout(userId: string, req: Request): Promise<void> {
    await this.logAuthEvent({
      action: AuditAction.LOGOUT,
      userId,
      ipAddress: this.extractIp(req),
      userAgent: req.headers['user-agent'],
      endpoint: req.path,
      method: req.method,
      status: AuditStatus.SUCCESS,
    });
  }

  private extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
    }
    return req.socket?.remoteAddress ?? req.ip ?? 'unknown';
  }
}

/**
 * Interceptor that automatically emits auth audit events for any
 * controller handler decorated with @AuthAudit().
 */
export const AUTH_AUDIT_KEY = 'authAuditAction';

export function AuthAudit(action: AuditAction): MethodDecorator {
  return (_target, _key, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(AUTH_AUDIT_KEY, action, descriptor.value);
    return descriptor;
  };
}

@Injectable()
export class AuthAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly authAuditService: AuthAuditService,
    private readonly reflector: any,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const action: AuditAction | undefined = this.reflector.get(
      AUTH_AUDIT_KEY,
      context.getHandler(),
    );
    if (!action) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const user = (req as any).user;

    return next.handle().pipe(
      tap(() => {
        this.authAuditService.logAuthEvent({
          action,
          userId: user?.id ?? user?.sub,
          ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip,
          userAgent: req.headers['user-agent'],
          endpoint: req.path,
          method: req.method,
          status: AuditStatus.SUCCESS,
        });
      }),
      catchError((err) => {
        this.authAuditService.logAuthEvent({
          action,
          userId: user?.id ?? user?.sub,
          ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.ip,
          userAgent: req.headers['user-agent'],
          endpoint: req.path,
          method: req.method,
          status: AuditStatus.FAILURE,
          errorMessage: err?.message,
        });
        return throwError(() => err);
      }),
    );
  }
}
