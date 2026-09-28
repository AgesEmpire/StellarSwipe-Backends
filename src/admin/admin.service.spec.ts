import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BadRequestException } from '@nestjs/common';
import { AdminManagementService } from './admin.service';
import { User } from '../users/entities/user.entity';
import { Signal } from '../signals/entities/signal.entity';
import { AuditLog } from '../audit-log/audit-log.entity';

describe('AdminManagementService — search index refresh events', () => {
  let service: AdminManagementService;
  let userRepository: any;
  let signalRepository: any;
  let auditLogRepository: any;
  let eventEmitter: { emit: jest.Mock };

  const makeUser = (overrides: Partial<User> = {}): User =>
    ({ id: 'user-1', isActive: true, ...overrides }) as User;

  beforeEach(async () => {
    userRepository = { findOne: jest.fn(), save: jest.fn() };
    signalRepository = {};
    auditLogRepository = { create: jest.fn((x) => x), save: jest.fn() };
    eventEmitter = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminManagementService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: getRepositoryToken(Signal), useValue: signalRepository },
        { provide: getRepositoryToken(AuditLog), useValue: auditLogRepository },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile();

    service = module.get<AdminManagementService>(AdminManagementService);
  });

  describe('suspendUser', () => {
    it('emits provider.deleted so suspended users drop out of search', async () => {
      const user = makeUser({ isActive: true });
      userRepository.findOne.mockResolvedValue(user);
      userRepository.save.mockResolvedValue({ ...user, isActive: false });

      await service.suspendUser('admin-1', 'user-1', { reason: 'fraud' } as any);

      expect(eventEmitter.emit).toHaveBeenCalledWith('provider.deleted', 'user-1');
    });

    it('does not emit when the user is already suspended', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ isActive: false }));

      await expect(
        service.suspendUser('admin-1', 'user-1', { reason: 'fraud' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('unsuspendUser', () => {
    it('emits provider.updated so reinstated users become searchable again', async () => {
      const user = makeUser({ isActive: false });
      userRepository.findOne.mockResolvedValue(user);
      userRepository.save.mockResolvedValue({ ...user, isActive: true });

      await service.unsuspendUser('admin-1', 'user-1');

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'provider.updated',
        expect.objectContaining({ id: 'user-1' }),
      );
    });

    it('does not emit when the user is already active', async () => {
      userRepository.findOne.mockResolvedValue(makeUser({ isActive: true }));

      await expect(service.unsuspendUser('admin-1', 'user-1')).rejects.toThrow(BadRequestException);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
