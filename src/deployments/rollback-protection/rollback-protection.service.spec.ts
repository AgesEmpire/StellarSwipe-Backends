import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException } from '@nestjs/common';
import { RollbackProtectionService } from './rollback-protection.service';
import { RollbackRequest, RollbackStatus } from './entities/rollback-request.entity';

describe('RollbackProtectionService', () => {
  let service: RollbackProtectionService;
  let mockRepo: any;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RollbackProtectionService,
        { provide: getRepositoryToken(RollbackRequest), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<RollbackProtectionService>(RollbackProtectionService);
  });

  describe('requestRollback', () => {
    it('should allow rollback of non-protected service', async () => {
      const dto = { serviceName: 'analytics-service', targetVersion: 'v1.2.0', reason: 'Rollback due to regression' };
      const saved = { id: 'r1', ...dto, requestedBy: 'u1', status: RollbackStatus.APPROVED, isProtected: false, createdAt: new Date() };
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);

      const result = await service.requestRollback('u1', dto);
      expect(result.status).toBe('approved');
    });

    it('should block rollback of protected service without forceOverride', async () => {
      const dto = { serviceName: 'payment-gateway', targetVersion: 'v1.0.0', reason: 'Emergency rollback' };
      const saved = { id: 'r2', ...dto, requestedBy: 'u1', status: RollbackStatus.PENDING_APPROVAL, isProtected: true, createdAt: new Date() };
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);

      await expect(service.requestRollback('u1', dto)).rejects.toThrow(ForbiddenException);
    });

    it('should log rollback attempts', async () => {
      const logSpy = jest.spyOn(service['logger'], 'log');
      const dto = { serviceName: 'analytics-service', targetVersion: 'v1.0.0', reason: 'Test' };
      const saved = { id: 'r3', ...dto, requestedBy: 'u1', status: RollbackStatus.APPROVED, isProtected: false, createdAt: new Date() };
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);

      await service.requestRollback('u1', dto);
      expect(logSpy).toHaveBeenCalled();
    });
  });

  describe('approveRollback', () => {
    it('should approve a pending rollback request', async () => {
      const request = { id: 'r1', serviceName: 'payment', status: RollbackStatus.PENDING_APPROVAL, reason: 'test', createdAt: new Date() };
      mockRepo.findOne.mockResolvedValue(request);
      mockRepo.save.mockResolvedValue({ ...request, status: RollbackStatus.APPROVED, approvedBy: 'admin-1' });

      const result = await service.approveRollback('r1', 'admin-1');
      expect(result.status).toBe('approved');
    });
  });
});
