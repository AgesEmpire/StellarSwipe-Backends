import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { CacheService, CachePrefix, CacheTTLType } from './cache.service';

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    const map: Record<string, number> = {
      'redisCache.ttl.session': 86400,
      'redisCache.ttl.signal': 30,
      'redisCache.ttl.portfolio': 300,
      'redisCache.ttl.default': 60,
    };
    return map[key];
  }),
};

describe('CacheService', () => {
  let service: CacheService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
  });

  describe('get / set / del', () => {
    it('returns cached value on hit', async () => {
      mockCacheManager.get.mockResolvedValue({ foo: 'bar' });
      const result = await service.get('key1');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('returns undefined on miss', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      const result = await service.get('missing');
      expect(result).toBeUndefined();
    });

    it('sets value with correct TTL in ms', async () => {
      mockCacheManager.set.mockResolvedValue(undefined);
      await service.set('key1', { x: 1 }, 'signal');
      expect(mockCacheManager.set).toHaveBeenCalledWith('key1', { x: 1 }, 30 * 1000);
    });

    it('deletes a key', async () => {
      mockCacheManager.del.mockResolvedValue(undefined);
      await service.del('key1');
      expect(mockCacheManager.del).toHaveBeenCalledWith('key1');
    });
  });

  describe('getOrSet', () => {
    it('returns cached value without calling fetchFn', async () => {
      mockCacheManager.get.mockResolvedValue({ cached: true });
      const fetchFn = jest.fn();
      const result = await service.getOrSet('key1', fetchFn, 'default');
      expect(result).toEqual({ cached: true });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('calls fetchFn on cache miss and stores result', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockCacheManager.set.mockResolvedValue(undefined);
      const fetchFn = jest.fn().mockResolvedValue({ fresh: true });
      const result = await service.getOrSet('key1', fetchFn, 'default');
      expect(result).toEqual({ fresh: true });
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(mockCacheManager.set).toHaveBeenCalledWith('key1', { fresh: true }, 60 * 1000);
    });
  });

  describe('getOrSetWithLock (stampede prevention)', () => {
    it('coalesces concurrent fetches into a single DB call', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockCacheManager.set.mockResolvedValue(undefined);

      let resolveDb: (v: any) => void;
      const dbPromise = new Promise((res) => { resolveDb = res; });
      const fetchFn = jest.fn().mockReturnValue(dbPromise);

      // Fire two concurrent requests for the same key
      const p1 = service.getOrSetWithLock('lock-key', fetchFn, 'default');
      const p2 = service.getOrSetWithLock('lock-key', fetchFn, 'default');

      resolveDb!({ value: 42 });
      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toEqual({ value: 42 });
      expect(r2).toEqual({ value: 42 });
      // fetchFn must only be called once despite two concurrent callers
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('returns cached value without calling fetchFn', async () => {
      mockCacheManager.get.mockResolvedValue({ hit: true });
      const fetchFn = jest.fn();
      const result = await service.getOrSetWithLock('key1', fetchFn);
      expect(result).toEqual({ hit: true });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('cleans up inflight map after resolution', async () => {
      mockCacheManager.get.mockResolvedValue(undefined);
      mockCacheManager.set.mockResolvedValue(undefined);
      const fetchFn = jest.fn().mockResolvedValue('done');

      await service.getOrSetWithLock('cleanup-key', fetchFn);

      // Second call should invoke fetchFn again (lock was released)
      mockCacheManager.get.mockResolvedValue(undefined);
      await service.getOrSetWithLock('cleanup-key', fetchFn);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('domain helpers', () => {
    it('getSession / setSession use SESSION prefix', async () => {
      mockCacheManager.get.mockResolvedValue({ userId: 'u1' });
      await service.getSession('sess-1');
      expect(mockCacheManager.get).toHaveBeenCalledWith(`${CachePrefix.SESSION}sess-1`);
    });

    it('getPortfolio / setPortfolio use PORTFOLIO prefix', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockCacheManager.set.mockResolvedValue(undefined);
      await service.setPortfolio('user-1', { total: 100 });
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        `${CachePrefix.PORTFOLIO}user-1`,
        { total: 100 },
        300 * 1000,
      );
    });
  });

  describe('getTTL', () => {
    it.each<[CacheTTLType, number]>([
      ['session', 86400],
      ['signal', 30],
      ['portfolio', 300],
      ['default', 60],
    ])('returns correct TTL for %s', (type, expected) => {
      expect(service.getTTL(type)).toBe(expected);
    });
  });
});
