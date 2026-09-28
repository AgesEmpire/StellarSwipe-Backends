import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditService } from './audit.service';
import { AuditEventListener } from './audit-event.listener';
import { AuditLog } from './entities/audit-log.entity';
import { AuditAction, AuditStatus } from './entities/audit-log.entity';
import { AuditEventType } from './audit.events';

describe('Audit Event System', () => {
  let auditService: AuditService;
  let auditListener: AuditEventListener;
  let eventEmitter: EventEmitter2;

  const mockAuditRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        AuditEventListener,
        EventEmitter2,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockAuditRepository,
        },
      ],
    }).compile();

    auditService = module.get<AuditService>(AuditService);
    auditListener = module.get<AuditEventListener>(AuditEventListener);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  describe('Successful audit event emission', () => {
    it('should emit and persist user login event', async () => {
      const mockEntry = {
        id: '1',
        userId: 'user-123',
        action: AuditAction.LOGIN,
        status: AuditStatus.SUCCESS,
        createdAt: new Date(),
      };

      mockAuditRepository.create.mockReturnValue(mockEntry);
      mockAuditRepository.save.mockResolvedValue(mockEntry);

      const payload = {
        userId: 'user-123',
        action: AuditEventType.USER_LOGIN,
        ipAddress: '192.168.1.1',
        status: 'SUCCESS' as const,
      };

      eventEmitter.emit(AuditEventType.USER_LOGIN, payload);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockAuditRepository.create).toHaveBeenCalled();
      expect(mockAuditRepository.save).toHaveBeenCalled();
    });

    it('should emit and persist API key creation event', async () => {
      const mockEntry = {
        id: '2',
        userId: 'user-456',
        action: AuditAction.API_KEY_CREATED,
        status: AuditStatus.SUCCESS,
        createdAt: new Date(),
      };

      mockAuditRepository.create.mockReturnValue(mockEntry);
      mockAuditRepository.save.mockResolvedValue(mockEntry);

      const payload = {
        userId: 'user-456',
        action: AuditEventType.API_KEY_CREATED,
        resource: 'API_KEY',
        resourceId: 'key-789',
        metadata: { keyName: 'Production Key' },
        status: 'SUCCESS' as const,
      };

      eventEmitter.emit(AuditEventType.API_KEY_CREATED, payload);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockAuditRepository.save).toHaveBeenCalled();
    });
  });

  describe('Failed audit event emission', () => {
    it('should emit and persist failed login event', async () => {
      const mockEntry = {
        id: '3',
        userId: 'user-789',
        action: AuditAction.LOGIN_FAILED,
        status: AuditStatus.FAILURE,
        errorMessage: 'Invalid credentials',
        createdAt: new Date(),
      };

      mockAuditRepository.create.mockReturnValue(mockEntry);
      mockAuditRepository.save.mockResolvedValue(mockEntry);

      const payload = {
        userId: 'user-789',
        action: AuditEventType.USER_LOGIN,
        status: 'FAILURE' as const,
        errorMessage: 'Invalid credentials',
        ipAddress: '192.168.1.100',
      };

      eventEmitter.emit(AuditEventType.USER_LOGIN, payload);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockAuditRepository.save).toHaveBeenCalled();
    });

    it('should emit and persist export failure event', async () => {
      const mockEntry = {
        id: '4',
        userId: 'user-999',
        action: AuditAction.DATA_EXPORT_FAILED,
        status: AuditStatus.FAILURE,
        errorMessage: 'Export service unavailable',
        createdAt: new Date(),
      };

      mockAuditRepository.create.mockReturnValue(mockEntry);
      mockAuditRepository.save.mockResolvedValue(mockEntry);

      const payload = {
        userId: 'user-999',
        action: AuditEventType.EXPORT_FAILED,
        status: 'FAILURE' as const,
        errorMessage: 'Export service unavailable',
        resource: 'EXPORT',
        resourceId: 'export-123',
      };

      eventEmitter.emit(AuditEventType.EXPORT_FAILED, payload);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockAuditRepository.save).toHaveBeenCalled();
    });
  });

  describe('Audit event handling resilience', () => {
    it('should not break application flow on audit log failure', async () => {
      mockAuditRepository.save.mockRejectedValue(
        new Error('Database connection failed'),
      );

      const payload = {
        userId: 'user-555',
        action: AuditEventType.USER_LOGIN,
      };

      // Should not throw
      await expect(
        auditListener.handleAuditEvent(payload),
      ).rejects.not.toThrow();
    });
  });
});
