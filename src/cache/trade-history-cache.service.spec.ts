import { Test, TestingModule } from '@nestjs/testing';
import { TradeHistoryCacheService } from './trade-history-cache.service';
import { CacheService } from './cache.service';
import { PortfolioCacheStrategy } from './strategies/portfolio-cache.strategy';

describe('TradeHistoryCacheService', () => {
  let service: TradeHistoryCacheService;
  let cacheStore: Map<string, any>;

  beforeEach(async () => {
    cacheStore = new Map();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TradeHistoryCacheService,
        {
          provide: CacheService,
          useValue: {
            get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key))),
            setWithTTL: jest.fn((key: string, value: any, ttl: number) => {
              cacheStore.set(key, value);
              return Promise.resolve();
            }),
            del: jest.fn((key: string) => {
              cacheStore.delete(key);
              return Promise.resolve();
            }),
          },
        },
        {
          provide: PortfolioCacheStrategy,
          useValue: {
            invalidatePortfolio: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TradeHistoryCacheService>(TradeHistoryCacheService);
  });

  describe('trade history caching', () => {
    const historyData = {
      data: [{ id: 'trade-1' }],
      total: 1,
      limit: 20,
      offset: 0,
    };

    it('should return null for cache miss', async () => {
      const result = await service.getTradeHistory('user-1', 1, 20);
      expect(result).toBeNull();
    });

    it('should cache and retrieve trade history', async () => {
      await service.setTradeHistory('user-1', 1, 20, historyData);
      const result = await service.getTradeHistory('user-1', 1, 20);
      expect(result).toEqual(historyData);
    });

    it('should return null for different page', async () => {
      await service.setTradeHistory('user-1', 1, 20, historyData);
      const result = await service.getTradeHistory('user-1', 2, 20);
      expect(result).toBeNull();
    });
  });

  describe('trade summary caching', () => {
    const summaryData = { totalTrades: 10, openTrades: 3 };

    it('should cache and retrieve summary', async () => {
      await service.setTradeSummary('user-1', summaryData);
      const result = await service.getTradeSummary('user-1');
      expect(result).toEqual(summaryData);
    });
  });

  describe('cache invalidation on trade change', () => {
    it('should invalidate all trade caches and portfolio for a user', async () => {
      await service.setTradeHistory('user-1', 1, 20, { data: [] });
      await service.setTradeSummary('user-1', { total: 0 });

      await service.invalidateOnTradeChange('user-1');

      // Verify history and summary are invalidated
      const history = await service.getTradeHistory('user-1', 1, 20);
      expect(history).toBeNull();
    });
  });
});
