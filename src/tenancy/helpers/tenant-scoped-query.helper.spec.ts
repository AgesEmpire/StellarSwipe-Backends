import { Test } from '@nestjs/testing';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { TenantScopingService, TENANT_COLUMN } from '../tenant-scoping.service';
import { TenantScopedQueryHelper } from './tenant-scoped-query.helper';
import { TenantScopedQueryBuilder } from './tenant-scoped-query.builder';

describe('TenantScopedQueryHelper', () => {
  let helper: TenantScopedQueryHelper;
  let tenantScopingService: TenantScopingService;
  let mockRepository: jest.Mocked<Repository<any>>;
  let mockQueryBuilder: jest.Mocked<SelectQueryBuilder<any>>;

  beforeEach(async () => {
    mockQueryBuilder = {
      alias: 'user',
      andWhere: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
      getMany: jest.fn(),
      getCount: jest.fn(),
      getManyAndCount: jest.fn(),
      getRawOne: jest.fn(),
      getRawMany: jest.fn(),
    } as any;

    mockRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        TenantScopedQueryHelper,
        {
          provide: TenantScopingService,
          useValue: {
            scopeQuery: jest.fn().mockImplementation((qb) => {
              qb.andWhere(`${qb.alias}.${TENANT_COLUMN} = :__tenantId`, {
                __tenantId: 'tenant-123',
              });
              return qb;
            }),
          },
        },
      ],
    }).compile();

    helper = module.get<TenantScopedQueryHelper>(TenantScopedQueryHelper);
    tenantScopingService = module.get<TenantScopingService>(TenantScopingService);
  });

  describe('createQueryBuilder', () => {
    it('should create a TenantScopedQueryBuilder', () => {
      const result = helper.createQueryBuilder(mockRepository, 'user');

      expect(result).toBeInstanceOf(TenantScopedQueryBuilder);
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('user');
    });

    it('should apply tenant scoping automatically', () => {
      helper.createQueryBuilder(mockRepository, 'user');

      expect(tenantScopingService.scopeQuery).toHaveBeenCalledWith(
        mockQueryBuilder,
        { alias: 'user' },
      );
    });
  });

  describe('wrapQueryBuilder', () => {
    it('should wrap an existing query builder with tenant scoping', () => {
      const result = helper.wrapQueryBuilder(mockQueryBuilder);

      expect(result).toBeInstanceOf(TenantScopedQueryBuilder);
      expect(tenantScopingService.scopeQuery).toHaveBeenCalled();
    });
  });

  describe('findByCondition', () => {
    it('should build a WHERE clause with tenant scoping', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([
        { id: '1', name: 'User 1' },
      ]);

      const condition = { id: '1', name: 'User 1' };
      await helper.findByCondition(mockRepository, 'user', condition);

      expect(mockQueryBuilder.where).toHaveBeenCalled();
      expect(tenantScopingService.scopeQuery).toHaveBeenCalled();
    });

    it('should return results from the query', async () => {
      const expected = [{ id: '1', name: 'User 1' }];
      mockQueryBuilder.getMany.mockResolvedValue(expected);

      const result = await helper.findByCondition(mockRepository, 'user', { id: '1' });

      expect(result).toEqual(expected);
    });
  });

  describe('findById', () => {
    it('should query by ID with tenant scoping', async () => {
      const expected = { id: '1', name: 'User 1' };
      mockQueryBuilder.getOne.mockResolvedValue(expected);

      const result = await helper.findById(mockRepository, 'user', '1');

      expect(result).toEqual(expected);
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'user.id = :id',
        { id: '1' },
      );
    });
  });

  describe('countByCondition', () => {
    it('should count entities matching a condition with tenant scoping', async () => {
      mockQueryBuilder.getCount.mockResolvedValue(5);

      const count = await helper.countByCondition(mockRepository, 'user', { active: true });

      expect(count).toBe(5);
      expect(tenantScopingService.scopeQuery).toHaveBeenCalled();
    });

    it('should return 0 when no conditions match', async () => {
      mockQueryBuilder.getCount.mockResolvedValue(0);

      const count = await helper.countByCondition(mockRepository, 'user', { active: false });

      expect(count).toBe(0);
    });
  });

  describe('TenantScopedQueryBuilder delegation', () => {
    it('should delegate where calls to inner query builder', () => {
      const qb = helper.createQueryBuilder(mockRepository, 'user');
      qb.where('user.email = :email', { email: 'test@example.com' });

      expect(mockQueryBuilder.where).toHaveBeenCalled();
    });

    it('should delegate andWhere calls', () => {
      const qb = helper.createQueryBuilder(mockRepository, 'user');
      qb.andWhere('user.active = :active', { active: true });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
    });

    it('should delegate limit and offset', () => {
      const qb = helper.createQueryBuilder(mockRepository, 'user');
      qb.limit(10).offset(20);

      expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
      expect(mockQueryBuilder.offset).toHaveBeenCalledWith(20);
    });

    it('should delegate orderBy', () => {
      const qb = helper.createQueryBuilder(mockRepository, 'user');
      qb.orderBy('user.createdAt', 'DESC');

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith('user.createdAt', 'DESC');
    });
  });
});
