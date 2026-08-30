import { of, throwError } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { PrivilegedAdminAuditInterceptor } from './privileged-admin-audit.interceptor';
import { AuditAction, AuditStatus } from '../../audit-log/entities/audit-log.entity';

function makeContext(overrides: Partial<any> = {}) {
  const request = {
    user: { id: 'admin-1' },
    ip: '10.0.0.1',
    headers: { 'x-request-id': 'req-123' },
    params: { id: 'user-42' },
    body: { role: 'moderator', password: 'should-be-redacted' },
    socket: {},
    ...overrides,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
  } as any;
}

describe('PrivilegedAdminAuditInterceptor', () => {
  const auditService = { log: jest.fn().mockResolvedValue(undefined) } as any;

  const buildReflector = (metadata: any) =>
    ({ get: jest.fn().mockReturnValue(metadata) }) as unknown as Reflector;

  beforeEach(() => jest.clearAllMocks());

  it('passes through untouched when no @PrivilegedAdminEvent metadata is present', (done) => {
    const interceptor = new PrivilegedAdminAuditInterceptor(buildReflector(undefined), auditService);
    const next = { handle: () => of({ ok: true }) };

    interceptor.intercept(makeContext(), next).subscribe(() => {
      expect(auditService.log).not.toHaveBeenCalled();
      done();
    });
  });

  it('records actor, IP, timestamp and redacted payload metadata on success', (done) => {
    const metadata = { action: AuditAction.ADMIN_USER_DELETED, resource: 'user' };
    const interceptor = new PrivilegedAdminAuditInterceptor(buildReflector(metadata), auditService);
    const next = { handle: () => of({ id: 'user-42' }) };

    interceptor.intercept(makeContext(), next).subscribe(() => {
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'admin-1',
          action: AuditAction.ADMIN_USER_DELETED,
          resource: 'user',
          resourceId: 'user-42',
          ipAddress: '10.0.0.1',
          requestId: 'req-123',
          status: AuditStatus.SUCCESS,
          metadata: expect.objectContaining({
            payload: expect.objectContaining({ password: '[REDACTED]', role: 'moderator' }),
          }),
        }),
      );
      done();
    });
  });

  it('records a FAILURE entry and rethrows when the handler errors', (done) => {
    const metadata = { action: AuditAction.ADMIN_OVERRIDE, resource: 'payout' };
    const interceptor = new PrivilegedAdminAuditInterceptor(buildReflector(metadata), auditService);
    const next = { handle: () => throwError(() => new Error('boom')) };

    interceptor.intercept(makeContext(), next).subscribe({
      error: (err) => {
        expect(err.message).toBe('boom');
        setImmediate(() => {
          expect(auditService.log).toHaveBeenCalledWith(
            expect.objectContaining({ status: AuditStatus.FAILURE, errorMessage: 'boom' }),
          );
          done();
        });
      },
    });
  });

  it('does not throw when audit persistence itself fails', (done) => {
    const metadata = { action: AuditAction.ADMIN_OVERRIDE, resource: 'payout' };
    const failingAuditService = { log: jest.fn().mockRejectedValue(new Error('db down')) } as any;
    const interceptor = new PrivilegedAdminAuditInterceptor(buildReflector(metadata), failingAuditService);
    const next = { handle: () => of({ ok: true }) };

    interceptor.intercept(makeContext(), next).subscribe(() => {
      expect(failingAuditService.log).toHaveBeenCalled();
      done();
    });
  });
});
