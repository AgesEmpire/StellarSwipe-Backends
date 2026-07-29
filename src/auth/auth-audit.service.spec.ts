import { Test, TestingModule } from '@nestjs/testing';
import { AuthAuditService } from './auth-audit.service';
import { AuditService } from '../audit-log/audit.service';
import { AuditAction, AuditStatus } from '../audit-log/entities/audit-log.entity';
import { Request } from 'express';

const mockAuditService = {
  log: jest.fn().mockResolvedValue({}),
};

const mockRequest = (overrides: Partial<Request> = {}): Request =>
  ({
    path: '/api/v1/auth/verify',
    method: 'POST',
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest-test' },
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request);

describe('AuthAuditService', () => {
  let service: AuthAuditService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthAuditService,
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get(AuthAuditService);
  });

  it('logLogin writes a LOGIN SUCCESS audit entry', async () => {
    await service.logLogin('user-123', mockRequest());
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.LOGIN,
        userId: 'user-123',
        status: AuditStatus.SUCCESS,
        resource: 'auth',
      }),
    );
  });

  it('logLoginFailed writes a LOGIN_FAILED FAILURE audit entry', async () => {
    await service.logLoginFailed(mockRequest(), 'Invalid signature');
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.LOGIN_FAILED,
        status: AuditStatus.FAILURE,
        errorMessage: 'Invalid signature',
      }),
    );
  });

  it('logLogout writes a LOGOUT SUCCESS audit entry', async () => {
    await service.logLogout('user-456', mockRequest());
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.LOGOUT,
        userId: 'user-456',
        status: AuditStatus.SUCCESS,
      }),
    );
  });

  it('does not throw when AuditService.log rejects', async () => {
    mockAuditService.log.mockRejectedValueOnce(new Error('DB down'));
    await expect(service.logLogin('user-789', mockRequest())).resolves.not.toThrow();
  });

  it('extracts IP from x-forwarded-for header', async () => {
    const req = mockRequest({ headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' } } as any);
    await service.logLogin('user-123', req);
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ ipAddress: '10.0.0.1' }),
    );
  });
});
