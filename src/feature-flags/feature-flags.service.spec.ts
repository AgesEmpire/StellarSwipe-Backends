import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlag } from './entities/feature-flag.entity';
import { FlagAssignment } from './entities/flag-assignment.entity';

describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;
  let mockFlagRepository: any;
  let mockAssignmentRepository: any;
  let mockCacheManager: any;

  let mockConfigService: { get: jest.Mock };

  beforeEach(async () => {
    mockFlagRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      delete: jest.fn(),
    };

    mockAssignmentRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      delete: jest.fn(),
    };

    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue(''),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagsService,
        {
          provide: getRepositoryToken(FeatureFlag),
          useValue: mockFlagRepository,
        },
        {
          provide: getRepositoryToken(FlagAssignment),
          useValue: mockAssignmentRepository,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<FeatureFlagsService>(FeatureFlagsService);
  });

  describe('env override', () => {
    it('should return enabled=true when env override is set to true', async () => {
      mockConfigService.get.mockReturnValue('new_trade_flow=true');

      // Re-create service with override config
      const module = await Test.createTestingModule({
        providers: [
          FeatureFlagsService,
          { provide: getRepositoryToken(FeatureFlag), useValue: mockFlagRepository },
          { provide: getRepositoryToken(FlagAssignment), useValue: mockAssignmentRepository },
          { provide: CACHE_MANAGER, useValue: mockCacheManager },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const svc = module.get<FeatureFlagsService>(FeatureFlagsService);
      const result = await svc.evaluateFlag('new_trade_flow', 'user-1');
      expect(result.enabled).toBe(true);
      expect(mockFlagRepository.findOne).not.toHaveBeenCalled();
    });

    it('should return enabled=false when env override is set to false', async () => {
      mockConfigService.get.mockReturnValue('new_trade_flow=false');

      const module = await Test.createTestingModule({
        providers: [
          FeatureFlagsService,
          { provide: getRepositoryToken(FeatureFlag), useValue: mockFlagRepository },
          { provide: getRepositoryToken(FlagAssignment), useValue: mockAssignmentRepository },
          { provide: CACHE_MANAGER, useValue: mockCacheManager },
          { provide: ConfigService, useValue: mockConfigService },
        ],
      }).compile();

      const svc = module.get<FeatureFlagsService>(FeatureFlagsService);
      const result = await svc.evaluateFlag('new_trade_flow', 'user-1');
      expect(result.enabled).toBe(false);
      expect(mockFlagRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('evaluateFlag', () => {
    it('should return disabled for disabled flag', async () => {
      const flag = {
        name: 'test_flag',
        enabled: false,
        type: 'boolean',
        config: {},
      };

      mockCacheManager.get.mockResolvedValue(null);
      mockFlagRepository.findOne.mockResolvedValue(flag);
      mockAssignmentRepository.findOne.mockResolvedValue(null);
      mockAssignmentRepository.create.mockReturnValue({});

      const result = await service.evaluateFlag('test_flag', 'user-123');
      expect(result.enabled).toBe(false);
    });

    it('should return enabled for boolean flag', async () => {
      const flag = {
        name: 'test_flag',
        enabled: true,
        type: 'boolean',
        config: {},
      };

      mockCacheManager.get.mockResolvedValue(null);
      mockFlagRepository.findOne.mockResolvedValue(flag);
      mockAssignmentRepository.findOne.mockResolvedValue(null);
      mockAssignmentRepository.create.mockReturnValue({});

      const result = await service.evaluateFlag('test_flag', 'user-123');
      expect(result.enabled).toBe(true);
    });

    it('should evaluate percentage rollout consistently', async () => {
      const flag = {
        name: 'test_flag',
        enabled: true,
        type: 'percentage',
        config: { percentage: 50 },
      };

      mockCacheManager.get.mockResolvedValue(null);
      mockFlagRepository.findOne.mockResolvedValue(flag);
      mockAssignmentRepository.findOne.mockResolvedValue(null);
      mockAssignmentRepository.create.mockReturnValue({});

      const result1 = await service.evaluateFlag('test_flag', 'user-123');
      const result2 = await service.evaluateFlag('test_flag', 'user-123');
      
      expect(result1.enabled).toBe(result2.enabled);
    });

    it('should check user list correctly', async () => {
      const flag = {
        name: 'test_flag',
        enabled: true,
        type: 'userList',
        config: { userList: ['user-123', 'user-456'] },
      };

      mockCacheManager.get.mockResolvedValue(null);
      mockFlagRepository.findOne.mockResolvedValue(flag);
      mockAssignmentRepository.findOne.mockResolvedValue(null);
      mockAssignmentRepository.create.mockReturnValue({});

      const result1 = await service.evaluateFlag('test_flag', 'user-123');
      expect(result1.enabled).toBe(true);

      const result2 = await service.evaluateFlag('test_flag', 'user-789');
      expect(result2.enabled).toBe(false);
    });

    it('should assign variant for A/B test', async () => {
      const flag = {
        name: 'test_flag',
        enabled: true,
        type: 'abTest',
        config: {
          variants: [
            { name: 'control', percentage: 50 },
            { name: 'variant_a', percentage: 50 },
          ],
        },
      };

      mockCacheManager.get.mockResolvedValue(null);
      mockFlagRepository.findOne.mockResolvedValue(flag);
      mockAssignmentRepository.findOne.mockResolvedValue(null);
      mockAssignmentRepository.create.mockReturnValue({});

      const result = await service.evaluateFlag('test_flag', 'user-123');
      expect(result.enabled).toBe(true);
      expect(result.variant).toBeDefined();
      expect(['control', 'variant_a']).toContain(result.variant);
    });

    it('should use cached result', async () => {
      const cachedResult = { enabled: true, variant: 'control' };
      mockCacheManager.get.mockResolvedValue(cachedResult);

      const result = await service.evaluateFlag('test_flag', 'user-123');
      expect(result).toEqual(cachedResult);
      expect(mockFlagRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('createFlag', () => {
    it('should create flag and invalidate cache', async () => {
      const dto = {
        name: 'new_flag',
        type: 'boolean' as const,
        enabled: true,
      };

      const createdFlag = { ...dto, id: 'flag-id' };
      mockFlagRepository.create.mockReturnValue(createdFlag);
      mockFlagRepository.save.mockResolvedValue(createdFlag);

      const result = await service.createFlag(dto);
      expect(result).toEqual(createdFlag);
      expect(mockCacheManager.del).toHaveBeenCalledWith('flag:new_flag');
    });
  });

  describe('updateFlag', () => {
    it('should update flag and invalidate cache', async () => {
      const existingFlag = {
        id: 'flag-id',
        name: 'test_flag',
        type: 'percentage',
        enabled: true,
        config: { percentage: 25 },
      };

      const updateDto = {
        config: { percentage: 50 },
      };

      mockFlagRepository.findOne.mockResolvedValue(existingFlag);
      mockFlagRepository.save.mockResolvedValue({ ...existingFlag, ...updateDto });

      const result = await service.updateFlag('test_flag', updateDto);
      expect(result.config.percentage).toBe(50);
      expect(mockCacheManager.del).toHaveBeenCalledWith('flag:test_flag');
    });
  });
});
