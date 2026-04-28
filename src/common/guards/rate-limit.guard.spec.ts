import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitTier, RATE_LIMIT_KEY } from '../decorators/rate-limit.decorator';

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
};

const mockReflector = {
  get: jest.fn(),
};

function buildContext(
  user?: { id: string },
  ip = '127.0.0.1',
): ExecutionContext {
  const response = { setHeader: jest.fn() };
  return {
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        headers: {},
        socket: { remoteAddress: ip },
      }),
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard (issue #482)', () => {
  let guard: RateLimitGuard;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    guard = module.get(RateLimitGuard);
  });

  it('allows request when under limit', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.PUBLIC });
    mockCacheManager.get.mockResolvedValue({ count: 5, resetTime: Date.now() + 60_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    await expect(guard.canActivate(buildContext(undefined, '10.0.0.1'))).resolves.toBe(true);
  });

  it('returns 429 when limit exceeded', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.PUBLIC });
    mockCacheManager.get.mockResolvedValue({ count: 100, resetTime: Date.now() + 60_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    await expect(guard.canActivate(buildContext(undefined, '10.0.0.2'))).rejects.toThrow(
      new HttpException(
        expect.objectContaining({ statusCode: HttpStatus.TOO_MANY_REQUESTS }),
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  });

  it('uses user ID as identifier for authenticated tier', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.AUTHENTICATED });
    mockCacheManager.get.mockResolvedValue(null);
    mockCacheManager.set.mockResolvedValue(undefined);

    await expect(guard.canActivate(buildContext({ id: 'user-abc' }))).resolves.toBe(true);

    const cacheKey: string = mockCacheManager.set.mock.calls[0][0];
    expect(cacheKey).toContain('user:user-abc');
  });

  it('resets counter after window expires', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.TRADE });
    mockCacheManager.get.mockResolvedValue({ count: 10, resetTime: Date.now() - 1 });
    mockCacheManager.set.mockResolvedValue(undefined);

    await expect(guard.canActivate(buildContext({ id: 'user-xyz' }))).resolves.toBe(true);
  });

  it('respects custom limit from per-endpoint decorator', async () => {
    // Simulate @RateLimit({ tier: PUBLIC, limit: 5, window: 60 })
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.PUBLIC, limit: 5, window: 60 });
    mockCacheManager.get.mockResolvedValue({ count: 5, resetTime: Date.now() + 60_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    await expect(guard.canActivate(buildContext(undefined, '10.0.0.3'))).rejects.toThrow(
      new HttpException(
        expect.objectContaining({ statusCode: HttpStatus.TOO_MANY_REQUESTS }),
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  });

  it('sets X-RateLimit-* headers on successful request', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.AUTHENTICATED, limit: 100 });
    mockCacheManager.get.mockResolvedValue({ count: 10, resetTime: Date.now() + 60_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext({ id: 'user-headers' });
    await guard.canActivate(ctx);

    const response = ctx.switchToHttp().getResponse() as { setHeader: jest.Mock };
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', expect.any(Number));
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(Number));
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
  });
});
