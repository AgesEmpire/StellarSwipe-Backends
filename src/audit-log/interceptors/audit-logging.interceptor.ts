import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request } from 'express';
import { AuditService } from '../audit.service';
import { AuditAction, AuditStatus } from '../entities/audit-log.entity';
import { CreateAuditLogDto } from '../dto/audit-query.dto';

export const AUDIT_ACTION_KEY = 'auditAction';

export interface AuditOptions {
  action: AuditAction;
  resource?: string;
  getResourceId?: (req: Request) => string | undefined;
  getMetadata?: (req: Request, result?: any) => Record<string, any>;
}

/**
 * Apply to controller handlers to emit an audit log entry on each invocation.
 *
 * @example
 * @Audit({ action: AuditAction.TRADE_EXECUTED, resource: 'trade' })
 * @Post(':id/execute')
 * executeTrade() { ... }
 */
export function Audit(options: AuditOptions): MethodDecorator {
  return (_target, _key, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(AUDIT_ACTION_KEY, options, descriptor.value);
    return descriptor;
  };
}

@Injectable()
export class AuditLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLoggingInterceptor.name);

  constructor(
    private readonly auditService: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const options: AuditOptions | undefined = this.reflector.get(
      AUDIT_ACTION_KEY,
      context.getHandler(),
    );

    if (!options) return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const user = (request as any).user;

    const baseDto: Omit<CreateAuditLogDto, 'status' | 'errorMessage'> = {
      userId: user?.id ?? user?.sub,
      action: options.action,
      resource: options.resource,
      resourceId: options.getResourceId?.(request) ?? request.params?.id,
      ipAddress: this.extractIp(request),
      userAgent: request.headers['user-agent'],
      sessionId: (request as any).sessionID,
      requestId: request.headers['x-request-id'] as string,
      metadata: options.getMetadata?.(request) ?? this.defaultMetadata(request),
    };

    return next.handle().pipe(
      tap((result) => {
        const meta = options.getMetadata?.(request, result);
        this.auditService
          .log({ ...baseDto, metadata: meta ?? baseDto.metadata, status: AuditStatus.SUCCESS })
          .catch((err) => this.logger.error('Async audit log failed', err.message));
      }),
      catchError((error) => {
        this.auditService
          .log({ ...baseDto, status: AuditStatus.FAILURE, errorMessage: error?.message ?? 'Unknown error' })
          .catch((err) => this.logger.error('Async audit log (error path) failed', err.message));
        return throwError(() => error);
      }),
    );
  }

  private extractIp(request: Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
      return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim();
    }
    return request.socket?.remoteAddress ?? request.ip ?? 'unknown';
  }

  private defaultMetadata(request: Request): Record<string, any> {
    return { method: request.method, path: request.path, params: request.params };
  }
}
