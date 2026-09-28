import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { CanaryRoutingService } from './canary-routing.service';
import { CanaryRoutingConfig } from './canary-routing.entity';

describe('CanaryRoutingService', () => {
  let service: CanaryRoutingService;
  let configRepo: jest.Mocked<Repository<CanaryRoutingConfig>>;
  let cacheManager: jest.Mocked<any>;

  const mockConfig: CanaryRoutingConfig = {
    id: '1',
    currentContractId: 'CA123456789',
    canaryContractId: 'CA987654321',
    canaryPercentage: 20,
    isActive: true,
    notes: 'Test canary',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockConfigRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    const mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanaryRoutingService,
        {
          provide: getRepositoryToken(CanaryRoutingConfig),
          useValue: mockConfigRepo,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCache,
        },
      ],
    }).compile();

    service = module.get<CanaryRoutingService>(CanaryRoutingService);
    configRepo = module.get(getRepositoryToken(CanaryRoutingConfig)) as jest.Mocked<
      Repository<CanaryRoutingConfig>
    >;
    cacheManager = module.get(CACHE_MANAGER);
  });

  describe('routeTrade', () => {
    it('should route to current contract when canary percentage is 0', async () => {
      const config = { ...mockConfig, canaryPercentage: 0 };
      cacheManager.get.mockResolvedValue(null);
      configRepo.findOne.mockResolvedValue(config);

      const result = await service.routeTrade('trade-123');

      expect(result.contractId).toBe(config.currentContractId);
      expect(result.isCanary).toBe(false);
      expect(result.canaryPercentage).toBe(0);
    });

    it('should route to canary contract when canary percentage is 100', async () => {
      const config = { ...mockConfig, canaryPercentage: 100 };
      cacheManager.get.mockResolvedValue(null);
      configRepo.findOne.mockResolvedValue(config);

      const result = await service.routeTrade('trade-123');

      expect(result.contractId).toBe(config.canaryContractId);
      expect(result.isCanary).toBe(true);
      expect(result.canaryPercentage).toBe(100);
    });

    it('should use deterministic hashing for consistent routing', async () => {
      cacheManager.get.mockResolvedValue(mockConfig);

      const result1 = await service.routeTrade('same-trade-id');
      cacheManager.get.mockResolvedValue(mockConfig); // Reset cache
      const result2 = await service.routeTrade('same-trade-id');

      expect(result1.contractId).toBe(result2.contractId);
      expect(result1.isCanary).toBe(result2.isCanary);
    });

    it('should distribute traffic approximately to canary percentage', async () => {
      const config = { ...mockConfig, canaryPercentage: 20 };
      cacheManager.get.mockResolvedValue(config);

      const samples = 1000;
      let canaryCount = 0;

      for (let i = 0; i < samples; i++) {
        const result = await service.routeTrade(`trade-${i}`);
        if (result.isCanary) canaryCount++;
      }

      const actualPercentage = (canaryCount / samples) * 100;
      // Allow 5% tolerance
      expect(actualPercentage).toBeGreaterThan(15);
      expect(actualPercentage).toBeLessThan(25);
    });

    it('should return empty config gracefully when no config exists', async () => {
      cacheManager.get.mockResolvedValue(null);
      configRepo.findOne.mockResolvedValue(null);

      const result = await service.routeTrade('trade-123');

      expect(result.contractId).toBe('');
      expect(result.isCanary).toBe(false);
      expect(result.canaryPercentage).toBe(0);
    });

    it('should use cached config on subsequent calls', async () => {
      cacheManager.get.mockResolvedValue(mockConfig);

      await service.routeTrade('trade-1');
      await service.routeTrade('trade-2');
      await service.routeTrade('trade-3');

      expect(cacheManager.get).toHaveBeenCalledTimes(3);
      expect(configRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('updateCanaryPercentage', () => {
    it('should update canary percentage successfully', async () => {
      cacheManager.get.mockResolvedValue(mockConfig);
      configRepo.save.mockResolvedValue({ ...mockConfig, canaryPercentage: 50 });

      const result = await service.updateCanaryPercentage(50, 'Testing 50%');

      expect(result.canaryPercentage).toBe(50);
      expect(result.notes).toBe('Testing 50%');
      expect(configRepo.save).toHaveBeenCalled();
      expect(cacheManager.del).toHaveBeenCalledWith('canary_routing_config');
    });

    it('should reject percentage below 0', async () => {
      cacheManager.get.mockResolvedValue(mockConfig);

      await expect(service.updateCanaryPercentage(-1)).rejects.toThrow(
        'Canary percentage must be between 0 and 100',
      );
    });

    it('should reject percentage above 100', async () => {
      cacheManager.get.mockResolvedValue(mockConfig);

      await expect(service.updateCanaryPercentage(101)).rejects.toThrow(
        'Canary percentage must be between 0 and 100',
      );
    });

    it('should throw when no active config exists', async () => {
      cacheManager.get.mockResolvedValue(null);
      configRepo.findOne.mockResolvedValue(null);

      await expect(service.updateCanaryPercentage(50)).rejects.toThrow(
        'No active canary routing config',
      );
    });

    it('should invalidate cache after update', async () => {
      cacheManager.get.mockResolvedValue(mockConfig);
      configRepo.save.mockResolvedValue({ ...mockConfig, canaryPercentage: 30 });

      await service.updateCanaryPercentage(30);

      expect(cacheManager.del).toHaveBeenCalledWith('canary_routing_config');
    });
  });

  describe('traffic split accuracy', () => {
    it('should achieve target distribution over large sample', async () => {
      const testCases = [
        { percentage: 10, min: 5, max: 15 },
        { percentage: 25, min: 20, max: 30 },
        { percentage: 50, min: 45, max: 55 },
        { percentage: 75, min: 70, max: 80 },
        { percentage: 90, min: 85, max: 95 },
      ];

      for (const testCase of testCases) {
        const config = { ...mockConfig, canaryPercentage: testCase.percentage };
        cacheManager.get.mockResolvedValue(config);

        const samples = 2000;
        let canaryCount = 0;

        for (let i = 0; i < samples; i++) {
          const result = await service.routeTrade(`trade-${i}`);
          if (result.isCanary) canaryCount++;
        }

        const actualPercentage = (canaryCount / samples) * 100;
        expect(actualPercentage).toBeGreaterThanOrEqual(testCase.min);
        expect(actualPercentage).toBeLessThanOrEqual(testCase.max);
      }
    });
  });
});
