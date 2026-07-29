import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionLimitsService } from './transaction-limits.service';
import {
  TransactionLimit,
  LimitType,
  LimitScope,
} from './entities/transaction-limit.entity';
import { TransactionUsage } from './entities/transaction-usage.entity';

describe('TransactionLimitsService', () => {
  let service: TransactionLimitsService;
  let limitRepository: Repository<TransactionLimit>;
  let usageRepository: Repository<TransactionUsage>;

  const mockLimitRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockUsageRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TransactionLimitsService,
        {
          provide: getRepositoryToken(TransactionLimit),
          useValue: mockLimitRepository,
        },
        {
          provide: getRepositoryToken(TransactionUsage),
          useValue: mockUsageRepository,
        },
      ],
    }).compile();

    service = module.get<TransactionLimitsService>(TransactionLimitsService);
    limitRepository = module.get(getRepositoryToken(TransactionLimit));
    usageRepository = module.get(getRepositoryToken(TransactionUsage));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('checkLimit', () => {
    it('should allow transaction within limit', async () => {
      const mockLimit: Partial<TransactionLimit> = {
        id: '1',
        userTier: 'basic',
        limitType: LimitType.DAILY,
        limitScope: LimitScope.WITHDRAWAL,
        limitAmount: '1000',
        currency: 'USD',
        isActive: true,
      };

      mockLimitRepository.find.mockResolvedValue([mockLimit]);
      mockUsageRepository.findOne.mockResolvedValue(null);

      const result = await service.checkLimit(
        'user-1',
        '500',
        'USD',
        LimitScope.WITHDRAWAL,
        'basic',
      );

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe('1000');
    });

    it('should reject transaction exceeding limit', async () => {
      const mockLimit: Partial<TransactionLimit> = {
        id: '1',
        userTier: 'basic',
        limitType: LimitType.DAILY,
        limitScope: LimitScope.WITHDRAWAL,
        limitAmount: '1000',
        currency: 'USD',
        isActive: true,
      };

      const mockUsage: Partial<TransactionUsage> = {
        userId: 'user-1',
        usedAmount: '800',
        limitType: LimitType.DAILY,
        limitScope: LimitScope.WITHDRAWAL,
      };

      mockLimitRepository.find.mockResolvedValue([mockLimit]);
      mockUsageRepository.findOne.mockResolvedValue(mockUsage);

      const result = await service.checkLimit(
        'user-1',
        '300',
        'USD',
        LimitScope.WITHDRAWAL,
        'basic',
      );

      expect(result.allowed).toBe(false);
      expect(result.message).toContain('limit');
    });

    it('should allow transaction when no limits configured', async () => {
      mockLimitRepository.find.mockResolvedValue([]);

      const result = await service.checkLimit(
        'user-1',
        '500',
        'USD',
        LimitScope.WITHDRAWAL,
        'basic',
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe('recordUsage', () => {
    it('should create new usage record', async () => {
      mockUsageRepository.findOne.mockResolvedValue(null);
      mockUsageRepository.create.mockReturnValue({
        userId: 'user-1',
        usedAmount: '500',
      });
      mockUsageRepository.save.mockResolvedValue({});

      await service.recordUsage(
        'user-1',
        '500',
        'USD',
        LimitScope.WITHDRAWAL,
        LimitType.DAILY,
      );

      expect(mockUsageRepository.create).toHaveBeenCalled();
      expect(mockUsageRepository.save).toHaveBeenCalled();
    });

    it('should update existing usage record', async () => {
      const mockUsage: Partial<TransactionUsage> = {
        userId: 'user-1',
        usedAmount: '300',
        limitType: LimitType.DAILY,
        limitScope: LimitScope.WITHDRAWAL,
      };

      mockUsageRepository.findOne.mockResolvedValue(mockUsage);
      mockUsageRepository.save.mockResolvedValue({});

      await service.recordUsage(
        'user-1',
        '200',
        'USD',
        LimitScope.WITHDRAWAL,
        LimitType.DAILY,
      );

      expect(mockUsage.usedAmount).toBe('500');
      expect(mockUsageRepository.save).toHaveBeenCalled();
    });
  });

  describe('createLimit', () => {
    it('should create a new transaction limit', async () => {
      const mockLimit: Partial<TransactionLimit> = {
        userTier: 'premium',
        limitType: LimitType.DAILY,
        limitScope: LimitScope.WITHDRAWAL,
        limitAmount: '5000',
        currency: 'USD',
      };

      mockLimitRepository.create.mockReturnValue(mockLimit);
      mockLimitRepository.save.mockResolvedValue(mockLimit);

      const result = await service.createLimit(
        'premium',
        null,
        LimitType.DAILY,
        LimitScope.WITHDRAWAL,
        '5000',
        'USD',
      );

      expect(result.limitAmount).toBe('5000');
      expect(mockLimitRepository.save).toHaveBeenCalled();
    });
  });
});
