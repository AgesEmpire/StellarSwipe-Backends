import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { FeesService } from './fees.service';
import { FeeTransaction, FeeStatus, FeeTier } from './entities/fee-transaction.entity';

describe('FeesService', () => {
  let service: FeesService;
  let feeRepository: Repository<FeeTransaction>;

  const mockFeeRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config = {
        STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
        STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
        PLATFORM_WALLET_SECRET: undefined,
      };
      return config[key] || defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeesService,
        {
          provide: getRepositoryToken(FeeTransaction),
          useValue: mockFeeRepository,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<FeesService>(FeesService);
    feeRepository = module.get<Repository<FeeTransaction>>(
      getRepositoryToken(FeeTransaction),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateFee', () => {
    it('should calculate standard fee correctly (0.1%)', async () => {
      const tradeDetails = {
        userId: 'user123',
        tradeId: 'trade456',
        tradeAmount: '1000',
        assetCode: 'USDC',
        assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      };

      mockFeeRepository.find.mockResolvedValue([]);

      const result = await service.calculateFee(tradeDetails);

      expect(result.feeAmount).toBe('1.0000000'); // 1000 * 0.001
      expect(result.feeRate).toBe('0.001');
      expect(result.feeTier).toBe(FeeTier.STANDARD);
      expect(result.netAmount).toBe('999.0000000');
      expect(result.tradeAmount).toBe('1000');
      expect(result.assetCode).toBe('USDC');
    });

    it('should calculate high volume fee correctly (0.08%)', async () => {
      const tradeDetails = {
        userId: 'user123',
        tradeId: 'trade456',
        tradeAmount: '1000',
        assetCode: 'USDC',
        assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      };

      // Mock user with high volume
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const mockHighVolumeFees = Array(10).fill(null).map((_, i) => ({
        userId: 'user123',
        tradeAmount: '1500',
        feeAmount: '1.5',
        status: FeeStatus.COLLECTED,
        createdAt: new Date(),
      }));

      mockFeeRepository.find.mockResolvedValue(mockHighVolumeFees);

      const result = await service.calculateFee(tradeDetails);

      expect(result.feeTier).toBe(FeeTier.HIGH_VOLUME);
      expect(result.feeRate).toBe('0.0008');
      expect(result.feeAmount).toBe('0.8000000'); // 1000 * 0.0008
      expect(result.netAmount).toBe('999.2000000');
    });

    it('should handle small amounts with proper rounding', async () => {
      const tradeDetails = {
        userId: 'user123',
        tradeId: 'trade456',
        tradeAmount: '0.123456789',
        assetCode: 'XLM',
        assetIssuer: 'native',
      };

      mockFeeRepository.find.mockResolvedValue([]);

      const result = await service.calculateFee(tradeDetails);

      // Fee should be rounded to 7 decimal places
      expect(result.feeAmount).toBe('0.0001234'); // 0.123456789 * 0.001, rounded
      expect(result.netAmount).toBe('0.1233333');
    });

    it('should throw error for negative trade amount', async () => {
      const tradeDetails = {
        userId: 'user123',
        tradeId: 'trade456',
        tradeAmount: '-100',
        assetCode: 'USDC',
        assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      };

      await expect(service.calculateFee(tradeDetails)).rejects.toThrow(
        'Trade amount must be positive',
      );
    });

    it('should throw error for zero trade amount', async () => {
      const tradeDetails = {
        userId: 'user123',
        tradeId: 'trade456',
        tradeAmount: '0',
        assetCode: 'USDC',
        assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      };

      await expect(service.calculateFee(tradeDetails)).rejects.toThrow(
        'Trade amount must be positive',
      );
    });
  });

  describe('calculateAndCollectFee', () => {
    it('should create fee transaction and mark as collected', async () => {
      const tradeDetails = {
        userId: 'user123',
        tradeId: 'trade456',
        tradeAmount: '1000',
        assetCode: 'USDC',
        assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      };

      const mockFeeTransaction = {
        id: 'fee789',
        userId: 'user123',
        tradeId: 'trade456',
        tradeAmount: '1000',
        feeAmount: '1.0000000',
        feeRate: '0.001',
        feeTier: FeeTier.STANDARD,
        assetCode: 'USDC',
        assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
        status: FeeStatus.PENDING,
      };

      mockFeeRepository.find.mockResolvedValue([]);
      mockFeeRepository.create.mockReturnValue(mockFeeTransaction);
      mockFeeRepository.save.mockResolvedValue({
        ...mockFeeTransaction,
        status: FeeStatus.COLLECTED,
      });

      const result = await service.calculateAndCollectFee(tradeDetails);

      expect(result.success).toBe(true);
      expect(result.feeTransaction).toBeDefined();
      expect(mockFeeRepository.create).toHaveBeenCalled();
      expect(mockFeeRepository.save).toHaveBeenCalled();
    });

    it('should handle fee collection failure gracefully', async () => {
      const tradeDetails = {
        userId: 'user123',
        tradeId: 'trade456',
        tradeAmount: '1000',
        assetCode: 'USDC',
        assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      };

      mockFeeRepository.find.mockResolvedValue([]);
      mockFeeRepository.create.mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(service.calculateAndCollectFee(tradeDetails)).rejects.toThrow(
        'Fee collection failed',
      );
    });
  });

  describe('getUserFeeSummary', () => {
    it('should calculate user fee summary correctly', async () => {
      const userId = 'user123';
      const mockUserFees = [
        {
          userId,
          tradeAmount: '1000',
          feeAmount: '1.0',
          status: FeeStatus.COLLECTED,
          createdAt: new Date(),
        },
        {
          userId,
          tradeAmount: '2000',
          feeAmount: '2.0',
          status: FeeStatus.COLLECTED,
          createdAt: new Date(),
        },
      ];

      mockFeeRepository.find.mockResolvedValue(mockUserFees);

      const result = await service.getUserFeeSummary(userId);

      expect(result.userId).toBe(userId);
      expect(result.totalFeesPaid).toBe('3.0000000');
      expect(result.totalTradeVolume).toBe('3000.0000000');
      expect(result.tradeCount).toBe(2);
      expect(result.currentFeeTier).toBe(FeeTier.STANDARD);
    });

    it('should return zero summary for user with no fees', async () => {
      const userId = 'newuser';
      mockFeeRepository.find.mockResolvedValue([]);

      const result = await service.getUserFeeSummary(userId);

      expect(result.userId).toBe(userId);
      expect(result.totalFeesPaid).toBe('0.0000000');
      expect(result.totalTradeVolume).toBe('0.0000000');
      expect(result.tradeCount).toBe(0);
    });
  });

  describe('getPlatformFeeSummary', () => {
    it('should generate platform summary correctly', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      const mockFees = [
        {
          userId: 'user1',
          tradeAmount: '1000',
          feeAmount: '1.0',
          assetCode: 'USDC',
          feeTier: FeeTier.STANDARD,
          status: FeeStatus.COLLECTED,
          createdAt: new Date('2024-01-15'),
        },
        {
          userId: 'user2',
          tradeAmount: '2000',
          feeAmount: '1.6',
          assetCode: 'XLM',
          feeTier: FeeTier.HIGH_VOLUME,
          status: FeeStatus.COLLECTED,
          createdAt: new Date('2024-01-20'),
        },
        {
          userId: 'user3',
          tradeAmount: '500',
          feeAmount: '0.5',
          assetCode: 'USDC',
          feeTier: FeeTier.STANDARD,
          status: FeeStatus.FAILED,
          createdAt: new Date('2024-01-25'),
        },
      ];

      mockFeeRepository.find.mockResolvedValue(mockFees);

      const result = await service.getPlatformFeeSummary(startDate, endDate);

      expect(result.totalFeesCollected).toBe('2.6000000'); // Only collected fees
      expect(result.totalTradeVolume).toBe('3500.0000000');
      expect(result.transactionCount).toBe(3);
      expect(result.failedCollections).toBe(1);
      expect(result.feesByTier[FeeTier.STANDARD]).toBeDefined();
      expect(result.feesByAsset['USDC']).toBeDefined();
      expect(result.feesByAsset['XLM']).toBeDefined();
    });
  });

  describe('generateMonthlyReport', () => {
    it('should generate comprehensive monthly report', async () => {
      const year = 2024;
      const month = 1;

      const mockCollectedFees = [
        {
          userId: 'user1',
          tradeAmount: '10000',
          feeAmount: '10.0',
          assetCode: 'USDC',
          feeTier: FeeTier.STANDARD,
          status: FeeStatus.COLLECTED,
          createdAt: new Date('2024-01-15'),
        },
        {
          userId: 'user1',
          tradeAmount: '5000',
          feeAmount: '5.0',
          assetCode: 'USDC',
          feeTier: FeeTier.STANDARD,
          status: FeeStatus.COLLECTED,
          createdAt: new Date('2024-01-20'),
        },
      ];

      const mockFailedFees = [
        {
          userId: 'user2',
          tradeAmount: '1000',
          feeAmount: '1.0',
          assetCode: 'XLM',
          feeTier: FeeTier.STANDARD,
          status: FeeStatus.FAILED,
          createdAt: new Date('2024-01-25'),
        },
      ];

      mockFeeRepository.find
        .mockResolvedValueOnce(mockCollectedFees)
        .mockResolvedValueOnce(mockFailedFees);

      const result = await service.generateMonthlyReport(year, month);

      expect(result.year).toBe(year);
      expect(result.month).toBe(month);
      expect(result.totalRevenue).toBe('15.0000000');
      expect(result.totalVolume).toBe('15000.0000000');
      expect(result.transactionCount).toBe(2);
      expect(result.uniqueUsers).toBe(1);
      expect(result.failedCollectionsTotal).toBe('1.0000000');
      expect(result.topUsers.length).toBeGreaterThan(0);
      expect(result.topUsers[0].userId).toBe('user1');
    });
  });

  describe('getFeeConfig', () => {
    it('should return current fee configuration', () => {
      const config = service.getFeeConfig();

      expect(config.standardRate).toBe('0.001');
      expect(config.highVolumeRate).toBe('0.0008');
      expect(config.vipRate).toBe('0.0005');
      expect(config.highVolumeThreshold).toBe('10000');
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large trade amounts', async () => {
      const tradeDetails = {
        userId: 'whale',
        tradeId: 'trade999',
        tradeAmount: '999999999.123456789',
        assetCode: 'USDC',
        assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      };

      mockFeeRepository.find.mockResolvedValue([]);

      const result = await service.calculateFee(tradeDetails);

      expect(result.feeAmount).toBeDefined();
      expect(parseFloat(result.feeAmount)).toBeGreaterThan(0);
      expect(result.feeAmount.split('.')[1].length).toBeLessThanOrEqual(7);
    });

    it('should handle precision correctly for tiny amounts', async () => {
      const tradeDetails = {
        userId: 'user123',
        tradeId: 'trade456',
        tradeAmount: '0.0000001',
        assetCode: 'XLM',
        assetIssuer: 'native',
      };

      mockFeeRepository.find.mockResolvedValue([]);

      const result = await service.calculateFee(tradeDetails);

      // Even tiny amounts should have valid fee calculation
      expect(result.feeAmount).toBeDefined();
      expect(parseFloat(result.feeAmount)).toBeGreaterThanOrEqual(0);
    });
  });
});