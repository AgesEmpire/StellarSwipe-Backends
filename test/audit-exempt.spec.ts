import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of } from 'rxjs';
import { AuditLoggingInterceptor } from '../src/audit-log/interceptors/audit-logging.interceptor';
import { AuditService } from '../src/audit-log/audit.service';
import { AUDIT_EXEMPT_KEY } from '../src/audit-log/decorators/audit-exempt.decorator';
import { AUDIT_ACTION_KEY } from '../src/audit-log/interceptors/audit-logging.interceptor';
import { AuditAction, AuditStatus } from '../src/audit-log/entities/audit-log.entity';

function createMockContext(handlerMeta: Record<string, any> = {}): ExecutionContext {
  const handler = jest.fn();
  const cls = class {};
  for (const [key, value] of Object.entries(handlerMeta)) {
    Reflect.defineMetadata(key, value, handler);
  }
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        path: '/health',
        params: {},
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1',
        user: { id: 'test-user' },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('AuditExempt decorator', () => {
  let interceptor: AuditLoggingInterceptor;
  let auditService: { log: jest.Mock };
  let reflector: Reflector;
  let next: CallHandler;

  beforeEach(() => {
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    reflector = new Reflector();
    interceptor = new AuditLoggingInterceptor(
      auditService as unknown as AuditService,
      reflector,
    );
    next = { handle: () => of({ ok: true }) };
  });

  it('skips audit logging when @AuditExempt() is applied', (done) => {
    const ctx = createMockContext({
      [AUDIT_ACTION_KEY]: { action: AuditAction.USER_UPDATED, resource: 'health' },
      [AUDIT_EXEMPT_KEY]: true,
    });

    interceptor.intercept(ctx, next).subscribe({
      complete: () => {
        expect(auditService.log).not.toHaveBeenCalled();
        done();
      },
    });
  });

  it('records audit log when @AuditExempt() is NOT applied', (done) => {
    const ctx = createMockContext({
      [AUDIT_ACTION_KEY]: { action: AuditAction.USER_UPDATED, resource: 'user' },
    });

    interceptor.intercept(ctx, next).subscribe({
      complete: () => {
        setTimeout(() => {
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ status: AuditStatus.SUCCESS }),
          );
          done();
        }, 10);
      },
    });
  });

  it('does not audit when handler has no @Audit() decorator at all', (done) => {
    const ctx = createMockContext({});

    interceptor.intercept(ctx, next).subscribe({
      complete: () => {
        expect(auditService.log).not.toHaveBeenCalled();
        done();
      },
    });
  });
});
