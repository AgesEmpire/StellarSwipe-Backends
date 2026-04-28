import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { RateLimitGuard } from '../src/common/guards/rate-limit.guard';
import { RateLimitTier, RATE_LIMIT_KEY } from '../src/common/decorators/rate-limit.decorator';

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
};

const mockReflector = {
  get: jest.fn(),
};

function buildContext(user?: { id: string }, ip = '127.0.0.1'): ExecutionContext {
  const headers: Record<string, string> = {};
  const response = {
    setHeader: jest.fn(),
  };
  return {
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user, headers, socket: { remoteAddress: ip } }),
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard (#372)', () => {
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

  it('should allow request when under limit', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.PUBLIC });
    mockCacheManager.get.mockResolvedValue({ count: 5, resetTime: Date.now() + 60_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext(undefined, '10.0.0.1');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should throw 429 when limit exceeded', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.PUBLIC });
    mockCacheManager.get.mockResolvedValue({ count: 100, resetTime: Date.now() + 60_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext(undefined, '10.0.0.2');
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new HttpException(expect.objectContaining({ statusCode: HttpStatus.TOO_MANY_REQUESTS }), HttpStatus.TOO_MANY_REQUESTS),
    );
  });

  it('should use user ID as identifier for authenticated tier', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.AUTHENTICATED });
    mockCacheManager.get.mockResolvedValue(null);
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext({ id: 'user-abc' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    const setCall = mockCacheManager.set.mock.calls[0];
    expect(setCall[0]).toContain('user:user-abc');
  });

  it('should reset counter after window expires', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.TRADE });
    // Expired window with count at limit
    mockCacheManager.get.mockResolvedValue({ count: 10, resetTime: Date.now() - 1 });
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext({ id: 'user-xyz' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
