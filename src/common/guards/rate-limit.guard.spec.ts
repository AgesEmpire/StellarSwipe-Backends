import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitTier } from '../decorators/rate-limit.decorator';

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
};

const mockReflector = {
  get: jest.fn(),
};

function buildConfigService(overrides: Record<string, string | number> = {}) {
  return { get: jest.fn((key: string) => overrides[key]) };
}

function buildContext(
  user?: { id: string },
  ip = '127.0.0.1',
  body: Record<string, string> = {},
): ExecutionContext {
  const response = { setHeader: jest.fn() };
  return {
    getHandler: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        user,
        headers: {},
        socket: { remoteAddress: ip },
        body,
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

    await expect(guard.canActivate(buildContext(undefined, '10.0.0.2'))).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: expect.objectContaining({ statusCode: HttpStatus.TOO_MANY_REQUESTS }),
    });
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

    await expect(guard.canActivate(buildContext(undefined, '10.0.0.3'))).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: expect.objectContaining({ statusCode: HttpStatus.TOO_MANY_REQUESTS }),
    });
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

  it('includes retry guidance and Retry-After header on 429 (issue #639)', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.TRADE });
    mockCacheManager.get.mockResolvedValue({ count: 10, resetTime: Date.now() + 30_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext({ id: 'user-retry' });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        retryAfter: expect.any(Number),
        guidance: expect.stringContaining('Retry after'),
      },
    });

    const response = ctx.switchToHttp().getResponse() as { setHeader: jest.Mock };
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });
});

describe('RateLimitGuard tier limits via environment variables (issue #639)', () => {
  it('falls back to hardcoded defaults when no ConfigService is provided', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    const guard = module.get(RateLimitGuard);

    mockReflector.get.mockReturnValue({ tier: RateLimitTier.PUBLIC });
    mockCacheManager.get.mockResolvedValue({ count: 100, resetTime: Date.now() + 60_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    // Default PUBLIC limit is 100 — the 101st request in-window must be rejected.
    await expect(guard.canActivate(buildContext(undefined, '10.0.0.10'))).rejects.toThrow(
      HttpException,
    );
  });

  it('honors RATE_LIMIT_<TIER>_LIMIT / _WINDOW env overrides over hardcoded defaults', async () => {
    const configService = buildConfigService({
      RATE_LIMIT_PUBLIC_LIMIT: 3,
      RATE_LIMIT_PUBLIC_WINDOW: 30,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    const guard = module.get(RateLimitGuard);

    mockReflector.get.mockReturnValue({ tier: RateLimitTier.PUBLIC });
    mockCacheManager.get.mockResolvedValue({ count: 3, resetTime: Date.now() + 30_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    // With the override, the configured limit of 3 is already met — the 4th request 429s
    // even though the hardcoded PUBLIC default of 100 would have allowed it.
    await expect(guard.canActivate(buildContext(undefined, '10.0.0.11'))).rejects.toThrow(
      HttpException,
    );
  });

  it('lets normal traffic through under a configured override limit', async () => {
    const configService = buildConfigService({
      RATE_LIMIT_PUBLIC_LIMIT: 3,
      RATE_LIMIT_PUBLIC_WINDOW: 30,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    const guard = module.get(RateLimitGuard);

    mockReflector.get.mockReturnValue({ tier: RateLimitTier.PUBLIC });
    mockCacheManager.get.mockResolvedValue({ count: 1, resetTime: Date.now() + 30_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    await expect(guard.canActivate(buildContext(undefined, '10.0.0.12'))).resolves.toBe(true);
  });
});

describe('RateLimitGuard AUTH tier and per-account limiting', () => {
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

  it('allows request when both IP and account limits are under threshold', async () => {
    mockReflector.get.mockReturnValue({
      tier: RateLimitTier.AUTH,
      limit: 5,
      window: 60,
      keyBy: ['email'],
      accountLimit: 3,
      accountWindow: 300,
    });
    mockCacheManager.get.mockResolvedValue({ count: 1, resetTime: Date.now() + 60_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext(undefined, '10.0.0.1', { email: 'user@example.com' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws 429 when per-account limit is exceeded even though IP limit is not', async () => {
    mockReflector.get.mockReturnValue({
      tier: RateLimitTier.AUTH,
      limit: 10,
      window: 60,
      keyBy: ['email'],
      accountLimit: 3,
      accountWindow: 300,
    });
    // First call (IP check): under limit. Second call (account check): at limit.
    mockCacheManager.get
      .mockResolvedValueOnce({ count: 1, resetTime: Date.now() + 60_000 })  // IP: ok
      .mockResolvedValueOnce({ count: 3, resetTime: Date.now() + 300_000 }); // account: at limit → 4th > 3
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext(undefined, '10.0.0.2', { email: 'victim@example.com' });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: expect.objectContaining({ statusCode: HttpStatus.TOO_MANY_REQUESTS }),
    });
  });

  it('skips account check when keyBy field is absent from body', async () => {
    mockReflector.get.mockReturnValue({
      tier: RateLimitTier.AUTH,
      limit: 5,
      window: 60,
      keyBy: ['email'],
      accountLimit: 3,
      accountWindow: 300,
    });
    mockCacheManager.get.mockResolvedValue({ count: 1, resetTime: Date.now() + 60_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    // Body has no email field — account check is skipped, only IP check runs
    const ctx = buildContext(undefined, '10.0.0.3', {});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    // Only one cache.get call (the IP check)
    expect(mockCacheManager.get).toHaveBeenCalledTimes(1);
  });

  it('normalises account identifier to lowercase for consistent keying', async () => {
    mockReflector.get.mockReturnValue({
      tier: RateLimitTier.AUTH,
      limit: 5,
      window: 60,
      keyBy: ['email'],
      accountLimit: 3,
      accountWindow: 300,
    });
    mockCacheManager.get.mockResolvedValue({ count: 0, resetTime: Date.now() + 60_000 });
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext(undefined, '10.0.0.4', { email: 'User@Example.COM' });
    await guard.canActivate(ctx);

    const accountSetCall = mockCacheManager.set.mock.calls.find(([k]: [string]) =>
      k.startsWith('rate_limit:account:'),
    );
    expect(accountSetCall).toBeDefined();
    expect(accountSetCall[0]).toContain('user@example.com');
  });

  it('uses RATE_LIMIT_AUTH_ACCOUNT_LIMIT env override for per-account limit', async () => {
    const configService = buildConfigService({
      RATE_LIMIT_AUTH_ACCOUNT_LIMIT: 2,
      RATE_LIMIT_AUTH_ACCOUNT_WINDOW: 60,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    const guardWithConfig = module.get(RateLimitGuard);

    // Config has accountLimit=2. Decorator has no accountLimit — should use the env override.
    mockReflector.get.mockReturnValue({
      tier: RateLimitTier.AUTH,
      limit: 10,
      window: 60,
      keyBy: ['email'],
    });
    mockCacheManager.get
      .mockResolvedValueOnce({ count: 1, resetTime: Date.now() + 60_000 })  // IP: ok
      .mockResolvedValueOnce({ count: 2, resetTime: Date.now() + 60_000 }); // account: at limit → 3rd > 2
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext(undefined, '10.0.0.5', { email: 'env-test@example.com' });
    await expect(guardWithConfig.canActivate(ctx)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });
});

describe('RateLimitGuard abuse pattern detection', () => {
  let guard: RateLimitGuard;
  let loggerWarnSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loggerWarnSpy = jest.spyOn((guard as any).logger, 'warn').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    loggerErrorSpy = jest.spyOn((guard as any).logger, 'error').mockImplementation(() => {});
  });

  it('logs abuse_pattern_detected when violation count reaches warn threshold', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.AUTH });
    // IP check: already at limit
    mockCacheManager.get
      .mockResolvedValueOnce({ count: 10, resetTime: Date.now() + 60_000 }) // triggers violation
      .mockResolvedValueOnce(2);                                              // abuse counter: 2 → becomes 3
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext(undefined, '10.0.0.6');
    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

    // Give the fire-and-forget abuse tracking a tick to complete
    await Promise.resolve();

    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Abuse pattern detected'),
      expect.objectContaining({ type: 'abuse_pattern_detected' }),
    );
  });

  it('logs persistent_abuse when violation count reaches error threshold', async () => {
    mockReflector.get.mockReturnValue({ tier: RateLimitTier.AUTH });
    mockCacheManager.get
      .mockResolvedValueOnce({ count: 10, resetTime: Date.now() + 60_000 }) // triggers violation
      .mockResolvedValueOnce(9);                                              // abuse counter: 9 → becomes 10
    mockCacheManager.set.mockResolvedValue(undefined);

    const ctx = buildContext(undefined, '10.0.0.7');
    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

    await Promise.resolve();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Persistent abuse detected'),
      expect.objectContaining({ type: 'persistent_abuse' }),
    );
  });
});
