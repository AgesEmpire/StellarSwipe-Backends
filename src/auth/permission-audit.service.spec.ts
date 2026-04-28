import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PermissionAuditService,
  PermissionAuditLog,
  AuditAction,
} from './permission-audit.service';

describe('PermissionAuditService', () => {
  let service: PermissionAuditService;
  let repository: Repository<PermissionAuditLog>;

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionAuditService,
        {
          provide: getRepositoryToken(PermissionAuditLog),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<PermissionAuditService>(PermissionAuditService);
    repository = module.get<Repository<PermissionAuditLog>>(
      getRepositoryToken(PermissionAuditLog),
    );

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('log', () => {
    it('should create and save an audit log entry', async () => {
      const dto = {
        actorId: 'actor-1',
        targetUserId: 'user-1',
        action: AuditAction.ROLE_ASSIGNED,
        resourceName: 'admin',
        metadata: { roleId: 'role-1' },
      };
      const mockEntry = { id: 'log-1', ...dto, createdAt: new Date() };

      mockRepository.create.mockReturnValue(mockEntry);
      mockRepository.save.mockResolvedValue(mockEntry);

      const result = await service.log(dto);

      expect(mockRepository.create).toHaveBeenCalledWith({
        actorId: dto.actorId,
        targetUserId: dto.targetUserId,
        action: dto.action,
        resourceName: dto.resourceName,
        metadata: dto.metadata,
      });
      expect(mockRepository.save).toHaveBeenCalledWith(mockEntry);
      expect(result).toEqual(mockEntry);
    });

    it('should default targetUserId to actorId when not provided', async () => {
      const dto = {
        actorId: 'actor-1',
        action: AuditAction.ROLE_CREATED,
        resourceName: 'editor',
      };
      const mockEntry = { id: 'log-2', ...dto, targetUserId: 'actor-1', createdAt: new Date() };

      mockRepository.create.mockReturnValue(mockEntry);
      mockRepository.save.mockResolvedValue(mockEntry);

      await service.log(dto);

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ targetUserId: 'actor-1' }),
      );
    });

    it('should default metadata to empty object when not provided', async () => {
      const dto = {
        actorId: 'actor-1',
        action: AuditAction.PERMISSION_GRANTED,
        resourceName: 'read:users',
      };
      const mockEntry = { id: 'log-3', ...dto, metadata: {}, createdAt: new Date() };

      mockRepository.create.mockReturnValue(mockEntry);
      mockRepository.save.mockResolvedValue(mockEntry);

      await service.log(dto);

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: {} }),
      );
    });
  });

  describe('query', () => {
    it('should return paginated audit logs', async () => {
      const logs = [{ id: 'log-1' }, { id: 'log-2' }] as PermissionAuditLog[];
      mockRepository.findAndCount.mockResolvedValue([logs, 2]);

      const result = await service.query({ actorId: 'actor-1', limit: 10, offset: 0 });

      expect(result).toEqual({ data: logs, total: 2 });
      expect(mockRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { actorId: 'actor-1' },
          take: 10,
          skip: 0,
          order: { createdAt: 'DESC' },
        }),
      );
    });

    it('should apply date range filter when from and to are provided', async () => {
      const from = new Date('2026-01-01');
      const to = new Date('2026-01-31');
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.query({ from, to });

      const call = mockRepository.findAndCount.mock.calls[0][0];
      expect(call.where.createdAt).toBeDefined();
    });

    it('should use default limit and offset when not provided', async () => {
      mockRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.query({});

      expect(mockRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0 }),
      );
    });
  });

  describe('getTrailForUser', () => {
    it('should return all audit logs for a given user', async () => {
      const logs = [{ id: 'log-1', targetUserId: 'user-1' }] as PermissionAuditLog[];
      mockRepository.find.mockResolvedValue(logs);

      const result = await service.getTrailForUser('user-1');

      expect(result).toEqual(logs);
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { targetUserId: 'user-1' },
        order: { createdAt: 'DESC' },
      });
    });
  });
});
