import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  AuditAction,
  AuditStatus,
} from '../../audit-log/entities/audit-log.entity';
import { AuditService } from '../../audit-log/audit.service';
import {
  AssignmentStatus,
  UserRole,
} from '../../authorization/entities/user-role.entity';
import { SessionInvalidationService } from './session-invalidation.service';
import { SessionManagerService } from './session-manager.service';

describe('SessionInvalidationService', () => {
  let service: SessionInvalidationService;
  let sessionManager: jest.Mocked<
    Pick<
      SessionManagerService,
      | 'getSession'
      | 'deleteSession'
      | 'getUserSessions'
      | 'deleteAllUserSessions'
    >
  >;
  let auditService: jest.Mocked<Pick<AuditService, 'log'>>;
  let userRoleRepository: jest.Mocked<Pick<Repository<UserRole>, 'find'>>;

  const adminActor = {
    userId: 'admin-1',
    username: 'admin',
  };

  const adminRoleAssignment = {
    status: AssignmentStatus.ACTIVE,
    expiresAt: null,
    role: { name: 'admin' },
    isActive: jest.fn(() => true),
  } as unknown as UserRole;

  beforeEach(() => {
    sessionManager = {
      getSession: jest.fn(),
      deleteSession: jest.fn(),
      getUserSessions: jest.fn(),
      deleteAllUserSessions: jest.fn(),
    };
    auditService = {
      log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };
    userRoleRepository = {
      find: jest.fn().mockResolvedValue([adminRoleAssignment]),
    };

    service = new SessionInvalidationService(
      sessionManager as unknown as SessionManagerService,
      auditService as unknown as AuditService,
      userRoleRepository as unknown as Repository<UserRole>,
    );
  });

  it('invalidates a single session immediately and writes an audit entry', async () => {
    sessionManager.getSession.mockResolvedValue({
      userId: 'user-1',
      publicKey: 'GPUBKEY',
      createdAt: 100,
      lastActivity: 200,
    });

    const result = await service.invalidate(
      { sessionId: 'sess-1', reason: 'suspicious activity' },
      adminActor,
      { ipAddress: '127.0.0.1', userAgent: 'jest', requestId: 'req-1' },
    );

    expect(sessionManager.deleteSession).toHaveBeenCalledWith('sess-1');
    expect(userRoleRepository.find).toHaveBeenCalledWith({
      where: { userId: 'admin-1', status: AssignmentStatus.ACTIVE },
      relations: ['role'],
    });
    expect(result).toEqual({
      invalidated: true,
      targetUserId: 'user-1',
      targetSessionId: 'sess-1',
      invalidatedSessionIds: ['sess-1'],
      auditId: 'audit-1',
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.SESSION_INVALIDATED,
        status: AuditStatus.SUCCESS,
        userId: 'admin-1',
        resource: 'auth-session',
        resourceId: 'sess-1',
        sessionId: 'sess-1',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
        requestId: 'req-1',
        metadata: expect.objectContaining({
          mode: 'session',
          targetUserId: 'user-1',
          reason: 'suspicious activity',
          invalidatedSessionIds: ['sess-1'],
        }),
      }),
    );
  });

  it('invalidates every active session for a user', async () => {
    sessionManager.getUserSessions.mockResolvedValue(['sess-a', 'sess-b']);

    const result = await service.invalidate(
      { userId: 'user-2' },
      { id: 'admin-2', role: 'administrator' },
    );

    expect(sessionManager.deleteAllUserSessions).toHaveBeenCalledWith('user-2');
    expect(result.invalidatedSessionIds).toEqual(['sess-a', 'sess-b']);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.SESSION_INVALIDATED,
        userId: 'admin-2',
        resource: 'auth-user-sessions',
        resourceId: 'user-2',
        metadata: expect.objectContaining({
          mode: 'user',
          targetUserId: 'user-2',
          invalidatedSessionIds: ['sess-a', 'sess-b'],
        }),
      }),
    );
  });

  it('rejects non-admin callers before deleting sessions', async () => {
    userRoleRepository.find.mockResolvedValue([]);

    await expect(
      service.invalidate({ sessionId: 'sess-1' }, { userId: 'user-1' }),
    ).rejects.toThrow(ForbiddenException);

    expect(sessionManager.deleteSession).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('returns not found for an unknown session id', async () => {
    sessionManager.getSession.mockResolvedValue(null);

    await expect(
      service.invalidate({ sessionId: 'missing' }, adminActor),
    ).rejects.toThrow(NotFoundException);

    expect(sessionManager.deleteSession).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });
});
