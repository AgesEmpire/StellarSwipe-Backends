import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AuditService } from '../../audit-log/audit.service';
import { AuditStatus } from '../../audit-log/entities/audit-log.entity';
import {
  PRIVILEGED_ADMIN_EVENT_KEY,
  PrivilegedAdminEventOptions,
} from './privileged-admin-event.decorator';

const SENSITIVE_BODY_FIELDS = new Set([
  'password',
  'newPassword',
  'privateKey',
  'secretKey',
  'mnemonic',
  'token',
]);

/**
 * Captures actor identity, IP, timestamp and payload metadata for any
 * endpoint annotated with @PrivilegedAdminEvent, persisting through the
 * existing AuditService so entries land in the same immutable audit trail
 * used for compliance/investigation and rollback workflows.
 *
 * Never throws on logging failure — a broken audit write must not block
 * the admin action itself (mirrors AuditService.log's own fail-safe
 * behavior), but it is logged loudly so the gap is observable.
 *
 * Wire globally with:
 *   { provide: APP_INTERCEPTOR, useClass: PrivilegedAdminAuditInterceptor }
 * or apply per-controller with @UseInterceptors(PrivilegedAdminAuditInterceptor).
 */
@Injectable()
export class PrivilegedAdminAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('PrivilegedAdminAudit');

  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const options = this.reflector.get<PrivilegedAdminEventOptions | undefined>(
      PRIVILEGED_ADMIN_EVENT_KEY,
      context.getHandler(),
    );

    if (!options) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const startedAt = new Date();
    const actorId: string | undefined = request.user?.id;
    const ipAddress: string | undefined =
      request.ip || request.headers?.['x-forwarded-for'] || request.socket?.remoteAddress;
    const requestId: string | undefined = request.headers?.['x-request-id'];
    const resourceId: string | undefined = request.params?.id;
    const payloadMetadata = this.redact(request.body);

    return next.handle().pipe(
      tap((result) => {
        void this.record(options, {
          actorId,
          ipAddress,
          requestId,
          resourceId,
          startedAt,
          status: AuditStatus.SUCCESS,
          payloadMetadata,
          resultSummary: this.summarizeResult(result),
        });
      }),
      catchError((error) => {
        void this.record(options, {
          actorId,
          ipAddress,
          requestId,
          resourceId,
          startedAt,
          status: AuditStatus.FAILURE,
          payloadMetadata,
          errorMessage: (error as Error)?.message,
        });
        throw error;
      }),
    );
  }

  private async record(
    options: PrivilegedAdminEventOptions,
    details: {
      actorId?: string;
      ipAddress?: string;
      requestId?: string;
      resourceId?: string;
      startedAt: Date;
      status: AuditStatus;
      payloadMetadata: Record<string, any>;
      resultSummary?: Record<string, any>;
      errorMessage?: string;
    },
  ): Promise<void> {
    try {
      await this.auditService.log({
        userId: details.actorId,
        action: options.action,
        resource: options.resource,
        resourceId: details.resourceId,
        ipAddress: details.ipAddress,
        requestId: details.requestId,
        status: details.status,
        errorMessage: details.errorMessage,
        metadata: {
          timestamp: details.startedAt.toISOString(),
          payload: details.payloadMetadata,
          result: details.resultSummary,
        },
      });
    } catch (error) {
      // Audit persistence must never break the admin request path.
      this.logger.error(
        `Failed to record privileged admin event ${options.action}: ${(error as Error).message}`,
      );
    }
  }

  private redact(body: unknown): Record<string, any> {
    if (!body || typeof body !== 'object') {
      return {};
    }
    return Object.fromEntries(
      Object.entries(body as Record<string, any>).map(([key, value]) =>
        SENSITIVE_BODY_FIELDS.has(key) ? [key, '[REDACTED]'] : [key, value],
      ),
    );
  }

  private summarizeResult(result: unknown): Record<string, any> | undefined {
    if (!result || typeof result !== 'object') {
      return undefined;
    }
    const { id } = result as Record<string, any>;
    return id !== undefined ? { id } : undefined;
  }
}
