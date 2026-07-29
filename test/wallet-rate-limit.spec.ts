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

function buildContext(
  user?: { id: string; walletAddress?: string },
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
        body: {},
      }),
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

describe('Wallet-based Rate Limiting', () => {
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

  it('should throttle a single wallet across different IPs', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.AUTHENTICATED });
    mockCacheManager.set.mockResolvedValue(undefined);

    const walletAddress = 'GABCDEF1234567890';
    let walletCallCount = 0;

    mockCacheManager.get.mockImplementation((key: string) => {
      if (key.includes('wallet:')) {
        walletCallCount++;
        if (walletCallCount > 600) {
          return Promise.resolve({ count: 600, resetTime: Date.now() + 60_000 });
        }
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });

    const ctx1 = buildContext({ id: 'user-1', walletAddress }, '10.0.0.1');
    await expect(guard.canActivate(ctx1)).resolves.toBe(true);

    const ctx2 = buildContext({ id: 'user-1', walletAddress }, '10.0.0.2');
    await expect(guard.canActivate(ctx2)).resolves.toBe(true);

    expect(mockCacheManager.set).toHaveBeenCalledWith(
      expect.stringContaining('wallet:'),
      expect.any(Object),
      expect.any(Number),
    );
  });

  it('should apply wallet limit in addition to IP limit', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.AUTHENTICATED });
    mockCacheManager.set.mockResolvedValue(undefined);

    mockCacheManager.get.mockImplementation((key: string) => {
      if (key.includes('wallet:')) {
        return Promise.resolve({ count: 700, resetTime: Date.now() + 60_000 });
      }
      return Promise.resolve(null);
    });

    const ctx = buildContext(
      { id: 'user-1', walletAddress: 'GABCDEF1234567890' },
      '10.0.0.1',
    );

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('should not apply wallet limit when no wallet address is present', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.PUBLIC });
    mockCacheManager.get.mockResolvedValue(null);
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext(undefined, '10.0.0.1');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    const walletSetCalls = mockCacheManager.set.mock.calls.filter(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('wallet:'),
    );
    expect(walletSetCalls).toHaveLength(0);
  });

  it('should use wallet-specific cache key distinct from IP key', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.AUTHENTICATED });
    mockCacheManager.get.mockResolvedValue(null);
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext(
      { id: 'user-1', walletAddress: 'GXYZ9876' },
      '10.0.0.1',
    );
    await guard.canActivate(ctx);

    const keys = mockCacheManager.set.mock.calls.map((c: any[]) => c[0]);
    const ipKey = keys.find((k: string) => k.startsWith('rate_limit:authenticated:'));
    const walletKey = keys.find((k: string) => k.startsWith('rate_limit:wallet:'));

    expect(ipKey).toBeDefined();
    expect(walletKey).toBeDefined();
    expect(walletKey).toContain('gxyz9876');
    expect(ipKey).not.toEqual(walletKey);
  });

  it('should reject same wallet from different IPs when wallet limit exceeded', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.TRADE });
    mockCacheManager.set.mockResolvedValue(undefined);

    mockCacheManager.get.mockImplementation((key: string) => {
      if (key.includes('wallet:')) {
        return Promise.resolve({ count: 100, resetTime: Date.now() + 60_000 });
      }
      return Promise.resolve(null);
    });

    const wallet = 'GSAMEWALLET';

    const ctx1 = buildContext({ id: 'user-1', walletAddress: wallet }, '192.168.1.1');
    await expect(guard.canActivate(ctx1)).rejects.toThrow(HttpException);

    const ctx2 = buildContext({ id: 'user-1', walletAddress: wallet }, '192.168.1.2');
    await expect(guard.canActivate(ctx2)).rejects.toThrow(HttpException);
  });
});
