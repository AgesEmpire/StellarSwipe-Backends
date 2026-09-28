import { Test, TestingModule } from '@nestjs/testing';
import { SignalFeedCacheService } from './signal-feed-cache.service';
import { CacheService } from './cache.service';
import { PortfolioCacheStrategy } from './strategies/portfolio-cache.strategy';

describe('SignalFeedCacheService', () => {
  let service: SignalFeedCacheService;
  let cacheStore: Map<string, any>;

  beforeEach(async () => {
    cacheStore = new Map();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalFeedCacheService,
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

    service = module.get<SignalFeedCacheService>(SignalFeedCacheService);
  });

  describe('feed caching', () => {
    const feedData = [{ id: 'sig-1', name: 'Buy XLM' }];

    it('should return null for cache miss', async () => {
      const result = await service.getFeed('ranked', 1, 20);
      expect(result).toBeNull();
    });

    it('should cache and retrieve feed', async () => {
      await service.setFeed('ranked', 1, 20, feedData);
      const result = await service.getFeed('ranked', 1, 20);
      expect(result).toEqual(feedData);
    });

    it('should return null for different sort order', async () => {
      await service.setFeed('ranked', 1, 20, feedData);
      const result = await service.getFeed('recent', 1, 20);
      expect(result).toBeNull();
    });
  });

  describe('signal detail caching', () => {
    const signalData = { id: 'sig-1', type: 'BUY' };

    it('should cache and retrieve signal detail', async () => {
      await service.setSignalDetail('sig-1', signalData);
      const result = await service.getSignalDetail('sig-1');
      expect(result).toEqual(signalData);
    });
  });

  describe('cache invalidation on signal change', () => {
    it('should invalidate all feed caches when signal changes', async () => {
      await service.setFeed('ranked', 1, 20, [{ id: 'sig-1' }]);
      await service.setFeed('recent', 1, 20, [{ id: 'sig-1' }]);
      await service.setSignalDetail('sig-1', { id: 'sig-1' });

      await service.invalidateOnSignalChange('sig-1');

      const feed = await service.getFeed('ranked', 1, 20);
      expect(feed).toBeNull();
    });

    it('should also invalidate provider portfolio on signal change', async () => {
      const portfolioCache = (service as any).portfolioCacheStrategy;
      await service.invalidateOnSignalChange('sig-1', 'provider-1');
      expect(portfolioCache.invalidatePortfolio).toHaveBeenCalledWith('provider-1');
    });
  });
});
