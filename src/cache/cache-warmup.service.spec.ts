import { Test, TestingModule } from '@nestjs/testing';
import { CacheWarmupService } from './cache-warmup.service';
import { CacheService } from './cache.service';

const mockCacheService = {
  get: jest.fn(),
  setWithTTL: jest.fn(),
};

describe('CacheWarmupService', () => {
  let service: CacheWarmupService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheWarmupService,
        { provide: CacheService, useValue: mockCacheService },
      ],
    }).compile();
    service = module.get(CacheWarmupService);
  });

  it('skips warmup when no tasks are registered', async () => {
    await service.onApplicationBootstrap();
    expect(mockCacheService.get).not.toHaveBeenCalled();
    expect(mockCacheService.setWithTTL).not.toHaveBeenCalled();
  });

  it('skips factory when persisted cache entry already exists (warm restart)', async () => {
    mockCacheService.get.mockResolvedValue({ price: 1.5 });
    const factory = jest.fn();

    service.register('market:XLM', factory, 60);
    await service.onApplicationBootstrap();

    expect(factory).not.toHaveBeenCalled();
    expect(mockCacheService.setWithTTL).not.toHaveBeenCalled();
  });

  it('calls factory and stores result when cache is cold', async () => {
    mockCacheService.get.mockResolvedValue(undefined);
    mockCacheService.setWithTTL.mockResolvedValue(undefined);
    const factory = jest.fn().mockResolvedValue({ price: 2.0 });

    service.register('market:XLM', factory, 120);
    await service.onApplicationBootstrap();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(mockCacheService.setWithTTL).toHaveBeenCalledWith('market:XLM', { price: 2.0 }, 120);
  });

  it('does not throw when an optional task factory fails', async () => {
    mockCacheService.get.mockResolvedValue(null);
    const failingFactory = jest.fn().mockRejectedValue(new Error('upstream down'));

    service.register('optional:key', failingFactory, 30, true);
    await expect(service.onApplicationBootstrap()).resolves.not.toThrow();
  });

  it('does not throw when a required task factory fails (startup must not block)', async () => {
    mockCacheService.get.mockResolvedValue(null);
    const failingFactory = jest.fn().mockRejectedValue(new Error('db error'));

    service.register('required:key', failingFactory, 60, false);
    await expect(service.onApplicationBootstrap()).resolves.not.toThrow();
  });

  it('warms multiple keys concurrently and logs success', async () => {
    mockCacheService.get.mockResolvedValue(undefined);
    mockCacheService.setWithTTL.mockResolvedValue(undefined);

    service.register('key:a', jest.fn().mockResolvedValue('a'), 10);
    service.register('key:b', jest.fn().mockResolvedValue('b'), 20);
    service.register('key:c', jest.fn().mockResolvedValue('c'), 30);

    await service.onApplicationBootstrap();

    expect(mockCacheService.setWithTTL).toHaveBeenCalledTimes(3);
  });
});
