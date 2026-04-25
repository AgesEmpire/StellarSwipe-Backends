import { Test, TestingModule } from '@nestjs/testing';
import { ResponseCacheService, ResponseCacheOptions } from './response-cache.service';
import { CacheService } from './cache.service';
import { Request } from 'express';

const mockCacheService = {
  get: jest.fn(),
  setWithTTL: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
};

const mockReq = (path: string, query: Record<string, string> = {}): Request =>
  ({ path, query, method: 'GET' } as unknown as Request);

describe('ResponseCacheService', () => {
  let service: ResponseCacheService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResponseCacheService,
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();

    service = module.get(ResponseCacheService);
  });

  describe('buildKey', () => {
    it('builds key from path', () => {
      const key = service.buildKey(mockReq('/currencies'), {});
      expect(key).toBe('stellarswipe:response:/currencies');
    });

    it('includes query params in key', () => {
      const key = service.buildKey(mockReq('/currencies', { base: 'USD' }), {});
      expect(key).toContain('USD');
    });

    it('includes userId when perUser=true', () => {
      const key = service.buildKey(mockReq('/portfolio'), { perUser: true }, 'user-1');
      expect(key).toContain('u:user-1');
    });

    it('omits userId when perUser=false', () => {
      const key = service.buildKey(mockReq('/rates'), { perUser: false }, 'user-1');
      expect(key).not.toContain('user-1');
    });

    it('uses keyPrefix when provided', () => {
      const key = service.buildKey(mockReq('/ignored'), { keyPrefix: 'custom-prefix' });
      expect(key).toContain('custom-prefix');
    });
  });

  describe('get', () => {
    it('returns cached value', async () => {
      mockCacheService.get.mockResolvedValueOnce({ data: 'cached' });
      const result = await service.get('some-key');
      expect(result).toEqual({ data: 'cached' });
    });

    it('returns undefined on cache miss', async () => {
      mockCacheService.get.mockResolvedValueOnce(undefined);
      const result = await service.get('missing-key');
      expect(result).toBeUndefined();
    });
  });

  describe('set', () => {
    it('calls setWithTTL with correct args', async () => {
      await service.set('my-key', { foo: 'bar' }, 120);
      expect(mockCacheService.setWithTTL).toHaveBeenCalledWith('my-key', { foo: 'bar' }, 120);
    });
  });

  describe('invalidate', () => {
    it('deletes the namespaced key', async () => {
      await service.invalidate('currencies');
      expect(mockCacheService.del).toHaveBeenCalledWith('stellarswipe:response:currencies');
    });
  });
});
