import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';
import { AuditStatus } from '../audit-log.entity';
import { SECURITY_AUDIT_KEY, SecurityAuditOptions } from './security-audit.decorator';
import { SecurityAuditService } from './security-audit.service';

/**
 * On success the audit write is awaited before responding; if it fails the
 * request fails, so a successful sensitive action can never go unaudited.
 * Failures are recorded best-effort and the original error is rethrown.
 */
@Injectable()
export class SecurityAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: SecurityAuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const opts = this.reflector.get<SecurityAuditOptions>(SECURITY_AUDIT_KEY, context.getHandler());
    if (!opts) return next.handle();

    const req = context.switchToHttp().getRequest();
    const correlationId =
      req.headers?.['x-correlation-id'] ?? req.headers?.['x-request-id'] ?? req.id ?? randomUUID();
    const base = {
      actorId: req.user?.id ?? req.user?.sub ?? null,
      action: opts.action,
      targetType: opts.targetType,
      targetId: req.params?.[opts.targetParam ?? 'id'] ?? null,
      correlationId: String(correlationId),
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
      metadata: { method: req.method, path: req.route?.path ?? req.url },
    };

    return next.handle().pipe(
      mergeMap((result) =>
        from(this.audit.record({ ...base, outcome: AuditStatus.SUCCESS }).then(() => result)),
      ),
      catchError((err) =>
        from(
          this.audit
            .record({ ...base, outcome: AuditStatus.FAILURE, errorMessage: err?.message })
            .catch(() => undefined),
        ).pipe(mergeMap(() => throwError(() => err))),
      ),
    );
  }
}
