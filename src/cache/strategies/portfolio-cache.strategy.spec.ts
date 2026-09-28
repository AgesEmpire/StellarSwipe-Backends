import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioCacheStrategy } from './portfolio-cache.strategy';
import { CACHE_MANAGER } from '@nestjs/cache-manager';

describe('PortfolioCacheStrategy', () => {
  let strategy: PortfolioCacheStrategy;
  let cacheStore: Map<string, any>;

  beforeEach(async () => {
    cacheStore = new Map();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioCacheStrategy,
        {
          provide: CACHE_MANAGER,
          useValue: {
            get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key))),
            set: jest.fn((key: string, value: any, ttl?: number) => {
              cacheStore.set(key, value);
              return Promise.resolve();
            }),
            del: jest.fn((key: string) => {
              cacheStore.delete(key);
              return Promise.resolve();
            }),
            clear: jest.fn(() => {
              cacheStore.clear();
              return Promise.resolve();
            }),
          },
        },
      ],
    }).compile();

    strategy = module.get<PortfolioCacheStrategy>(PortfolioCacheStrategy);
  });

  describe('portfolio caching', () => {
    const portfolioData = {
      userId: 'user-1',
      totalValue: '1000.00',
      positions: [],
      updatedAt: new Date(),
    };

    it('should return null for cache miss', async () => {
      const result = await strategy.getPortfolio('user-1');
      expect(result).toBeNull();
    });

    it('should cache and retrieve portfolio data', async () => {
      await strategy.setPortfolio('user-1', portfolioData);
      const result = await strategy.getPortfolio('user-1');
      expect(result).toEqual(portfolioData);
    });

    it('should invalidate portfolio cache', async () => {
      await strategy.setPortfolio('user-1', portfolioData);
      await strategy.invalidatePortfolio('user-1');
      const result = await strategy.getPortfolio('user-1');
      expect(result).toBeNull();
    });
  });

  describe('orderbook caching', () => {
    const orderbookData = {
      baseAsset: 'XLM',
      counterAsset: 'USDC',
      bids: [{ price: '0.12', amount: '1000' }],
      asks: [{ price: '0.13', amount: '500' }],
      timestamp: new Date(),
    };

    it('should return null for cache miss', async () => {
      const result = await strategy.getOrderbook('XLM', 'USDC');
      expect(result).toBeNull();
    });

    it('should cache and retrieve orderbook', async () => {
      await strategy.setOrderbook('XLM', 'USDC', orderbookData);
      const result = await strategy.getOrderbook('XLM', 'USDC');
      expect(result).toEqual(orderbookData);
    });

    it('should invalidate orderbook cache', async () => {
      await strategy.setOrderbook('XLM', 'USDC', orderbookData);
      await strategy.invalidateOrderbook('XLM', 'USDC');
      const result = await strategy.getOrderbook('XLM', 'USDC');
      expect(result).toBeNull();
    });
  });

  describe('cache-aside pattern', () => {
    it('should fetch and cache on miss via getOrFetchPortfolio', async () => {
      const fetchFn = jest.fn(async () => ({
        userId: 'user-1',
        totalValue: '500.00',
        positions: [],
        updatedAt: new Date(),
      }));

      const result = await strategy.getOrFetchPortfolio('user-1', fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result.totalValue).toBe('500.00');

      // Second call should hit cache
      const result2 = await strategy.getOrFetchPortfolio('user-1', fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1); // Not called again
      expect(result2.totalValue).toBe('500.00');
    });

    it('should fetch and cache on miss via getOrFetchOrderbook', async () => {
      const fetchFn = jest.fn(async () => ({
        baseAsset: 'BTC',
        counterAsset: 'USD',
        bids: [],
        asks: [],
        timestamp: new Date(),
      }));

      const result = await strategy.getOrFetchOrderbook('BTC', 'USD', fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(result.baseAsset).toBe('BTC');
    });
  });
});
