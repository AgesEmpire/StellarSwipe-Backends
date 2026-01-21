import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioService } from './portfolio.service';
import { PriceService } from '../shared/price.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Trade, TradeStatus, TradeSide } from '../trades/entities/trade.entity';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

describe('PortfolioService', () => {
  let service: PortfolioService;

  // Mocks are used directly

  const mockTradeRepository = {
    find: jest.fn(),
    findAndCount: jest.fn(),
  };

  const mockPriceService = {
    getMultiplePrices: jest.fn(),
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        {
          provide: PriceService,
          useValue: mockPriceService,
        },
        {
          provide: getRepositoryToken(Trade),
          useValue: mockTradeRepository,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<PortfolioService>(PortfolioService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPositions', () => {
    it('should calculate unrealized P&L correctly for open positions', async () => {
      const mockTrades = [
        {
          id: '1',
          assetSymbol: 'BTC',
          amount: 1,
          entryPrice: 50000,
          status: TradeStatus.OPEN,
          side: TradeSide.BUY,
          openedAt: new Date(),
        },
      ];
      mockTradeRepository.find.mockResolvedValue(mockTrades);
      mockPriceService.getMultiplePrices.mockResolvedValue({ BTC: 55000 });

      const result = await service.getPositions('user1');

      expect(result).toHaveLength(1);
      expect(result[0].unrealizedPnL).toBe(5000 * 1); // (55000 - 50000) * 1
      expect(result[0].currentPrice).toBe(55000);
    });

    it('should return empty array if no open positions', async () => {
      mockTradeRepository.find.mockResolvedValue([]);
      const result = await service.getPositions('user1');
      expect(result).toEqual([]);
    });
  });

  describe('getPerformance', () => {
    it('should calculate performance metrics correctly', async () => {
      const mockTrades = [
        {
          status: TradeStatus.CLOSED,
          realizedPnl: 100,
        },
        {
          status: TradeStatus.CLOSED,
          realizedPnl: -50,
        },
        {
          status: TradeStatus.OPEN,
          assetSymbol: 'ETH',
          amount: 10,
          entryPrice: 2000,
          entryValue: 20000,
          side: TradeSide.BUY,
        },
      ];
      mockCacheManager.get.mockResolvedValue(null);
      mockTradeRepository.find.mockResolvedValue(mockTrades);
      mockPriceService.getMultiplePrices.mockResolvedValue({ ETH: 2100 });

      const result = await service.getPerformance('user1');

      expect(result.realizedPnL).toBe(50); // 100 - 50
      expect(result.winRate).toBe(0.5); // 1 win / 2 closed
      expect(result.openPositions).toBe(1);
      
      // ETH Unrealized: (2100 - 2000) * 10 = 1000
      expect(result.unrealizedPnL).toBe(1000);
      
      // Total Value: 10 * 2100 = 21000
      expect(result.totalValue).toBe(21000);
    });

    it('should return cached data if available', async () => {
      const cachedData = { realizedPnL: 999 };
      mockCacheManager.get.mockResolvedValue(cachedData);

      const result = await service.getPerformance('user1');
      expect(result).toEqual(cachedData);
      expect(mockTradeRepository.find).not.toHaveBeenCalled();
    });
  });
});
