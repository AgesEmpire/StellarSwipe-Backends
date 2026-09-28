import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { Trade, TradeStatus, TradeSide } from '../trades/entities/trade.entity';
import { Position } from './entities/position.entity';
import { User } from '../users/entities/user.entity';
import { PnlHistory } from './entities/pnl-history.entity';
import { PriceService } from '../shared/price.service';
import { PnlCalculatorService } from './services/pnl-calculator.service';
import { OutboxService } from '../events/outbox.service';

const VALID_WALLET = 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBKM6GS6HMDE';

describe('PortfolioService', () => {
  let service: PortfolioService;
  let mockTradeRepository: any;
  let mockPositionRepository: any;
  let mockUserRepository: any;
  let mockPnlHistoryRepository: any;
  let mockPriceService: any;
  let mockCacheManager: any;
  let mockPnlCalculator: any;
  let mockOutboxService: any;

  beforeEach(async () => {
    const mockOutboxRepository = {
      create: jest.fn((entity: unknown, dto: unknown) => dto),
      save: jest.fn().mockResolvedValue({ id: 'outbox-event-1' }),
    };

    mockTradeRepository = {
      find: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn().mockImplementation(async (trade) => ({ ...trade, id: 'trade-1' })),
      manager: {
        transaction: jest.fn().mockImplementation(async (fn) =>
          fn({
            create: jest.fn((entity: unknown, dto: unknown) => dto),
            save: jest.fn().mockImplementation(async (entity: unknown) => ({ ...entity, id: 'trade-1' })),
            getRepository: jest.fn().mockReturnValue(mockOutboxRepository),
          }),
        ),
      },
    };

    mockPositionRepository = {
      find: jest.fn(),
      save: jest.fn(),
    };

    mockUserRepository = {
      findOne: jest.fn(),
    };

    mockPnlHistoryRepository = {
      createQueryBuilder: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };

    mockPriceService = {
      getMultiplePrices: jest.fn().mockResolvedValue({}),
    };

    mockCacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };

    mockPnlCalculator = {
      calculateUnrealizedPnL: jest.fn().mockReturnValue(2),
      calculatePortfolioPnl: jest.fn().mockReturnValue({ realizedPnL: 0, unrealizedPnL: 0 }),
    };

    mockOutboxService = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        {
          provide: getRepositoryToken(Trade),
          useValue: mockTradeRepository,
        },
        {
          provide: getRepositoryToken(Position),
          useValue: mockPositionRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(PnlHistory),
          useValue: mockPnlHistoryRepository,
        },
        {
          provide: PriceService,
          useValue: mockPriceService,
        },
        {
          provide: PnlCalculatorService,
          useValue: mockPnlCalculator,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
        {
          provide: OutboxService,
          useValue: mockOutboxService,
        },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPositions', () => {
    it('should return positions with calculated P&L', async () => {
      const mockTrade = {
        id: 'trade-1',
        baseAsset: 'XLM',
        counterAsset: 'USDC',
        amount: '100',
        entryPrice: '0.1',
        side: TradeSide.BUY,
        createdAt: new Date(),
      };
      
      mockTradeRepository.find.mockResolvedValue([mockTrade]);
      mockPriceService.getMultiplePrices.mockResolvedValue({
        'XLM/USDC': 0.12,
      });
      
      const result = await service.getPositions('user-id');
      
      expect(result[0].unrealizedPnL).toBe(2); // (0.12 - 0.1) * 100
    });
  });

  describe('addTransaction', () => {
    it('should save a trade and enqueue an outbox event', async () => {
      const dto = {
        side: 'buy',
        baseAsset: 'XLM',
        counterAsset: 'USDC',
        amount: 100,
        entryPrice: 0.1,
        feeAmount: 0.5,
      };

      const result = await service.addTransaction('user-id', dto as any);

      expect(result).toMatchObject({ id: 'trade-1' });
      expect(mockOutboxService.enqueue).toHaveBeenCalledTimes(1);
      expect(mockCacheManager.del).toHaveBeenCalledWith('portfolio_performance_user-id');
    });
  });

  describe('getPerformance', () => {
    it('should calculate performance metrics', async () => {
      mockCacheManager.get.mockResolvedValue(null);

      const mockTrades = [
        {
          status: TradeStatus.COMPLETED,
          profitLoss: '50',
          side: TradeSide.BUY,
          baseAsset: 'XLM',
          counterAsset: 'USDC',
        },
      ];

      mockTradeRepository.find.mockResolvedValue(mockTrades);
      mockPnlCalculator.calculatePortfolioPnl.mockReturnValue({ realizedPnL: 50, unrealizedPnL: 0 });

      const result = await service.getPerformance('user-id');

      expect(result.realizedPnL).toBe(50);
      expect(result.winRate).toBe(100);
    });
  });

  describe('getWalletSummary', () => {
    it('should reject an invalid wallet address', async () => {
      await expect(service.getWalletSummary('invalid-wallet')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when wallet has no account', async () => {
      mockUserRepository.findOne.mockResolvedValue(null);
      await expect(service.getWalletSummary(VALID_WALLET)).rejects.toThrow(NotFoundException);
    });

    it('should return cached summary on repeated calls', async () => {
      const cached = { walletAddress: VALID_WALLET, totalValue: 500, unrealizedPnL: 10, realizedPnL: 20, openPositions: 1, winRate: 75 };
      mockCacheManager.get.mockResolvedValue(cached);
      const result = await service.getWalletSummary(VALID_WALLET);
      expect(result).toBe(cached);
      expect(mockUserRepository.findOne).not.toHaveBeenCalled();
    });

    it('should return full summary shape for a valid wallet', async () => {
      mockUserRepository.findOne.mockResolvedValue({ id: 'user-uuid' });
      mockTradeRepository.find.mockResolvedValue([]);
      mockPnlCalculator.calculatePortfolioPnl.mockReturnValue({ realizedPnL: 100, unrealizedPnL: 25 });

      const result = await service.getWalletSummary(VALID_WALLET);

      expect(result.walletAddress).toBe(VALID_WALLET);
      expect(typeof result.totalValue).toBe('number');
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        `portfolio_wallet_summary_${VALID_WALLET}`,
        expect.objectContaining({ walletAddress: VALID_WALLET }),
        30000,
      );
    });
  });
});
