import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ExternalIntegrationThrottlerGuard } from './external-integration-throttler.guard';

/**
 * #1380 — ExternalIntegrationThrottlerGuard previously threw a 429 without
 * setting any rate-limit headers, unlike RateLimitGuard/RateLimitMiddleware/
 * DistributedThrottlerGuard. These tests cover the standardized headers it
 * now sets on `throwThrottlingException`.
 *
 * The guard's constructor pulls in the full @nestjs/throttler DI graph
 * (options/storage/reflector), which isn't needed to exercise
 * `throwThrottlingException` in isolation — so the instance is built via
 * `Object.create` and the base class's protected `getLimit`/`getTtl` are
 * stubbed directly, the same way the guard calls them internally.
 */
describe('ExternalIntegrationThrottlerGuard', () => {
  function buildContext(url = '/api-keys') {
    const response = { setHeader: jest.fn() };
    const request = {
      url,
      headers: {},
      socket: { remoteAddress: '203.0.113.5' },
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
  }

  function buildGuard(limit: number, ttlMs: number): ExternalIntegrationThrottlerGuard {
    const guard = Object.create(
      ExternalIntegrationThrottlerGuard.prototype,
    ) as ExternalIntegrationThrottlerGuard;
    (guard as any).logger = { warn: jest.fn() };
    (guard as any).getLimit = jest.fn().mockResolvedValue(limit);
    (guard as any).getTtl = jest.fn().mockResolvedValue(ttlMs);
    return guard;
  }

  it('sets standardized X-RateLimit-*/Retry-After headers before throwing 429', async () => {
    const guard = buildGuard(30, 60_000);
    const context = buildContext();
    const response = context.switchToHttp().getResponse() as { setHeader: jest.Mock };

    await expect(
      (guard as any).throwThrottlingException(context),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
      response: expect.objectContaining({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        retryAfter: 60,
      }),
    });

    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 30);
    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', 60);
  });

  it('derives Retry-After from the configured ttl rather than a hardcoded value', async () => {
    const guard = buildGuard(10, 15_000);
    const context = buildContext('/currency/rates');
    const response = context.switchToHttp().getResponse() as { setHeader: jest.Mock };

    await expect((guard as any).throwThrottlingException(context)).rejects.toBeInstanceOf(
      HttpException,
    );

    expect(response.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 10);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', 15);
  });

  it('includes an apikey-derived identifier in the warning log without logging the full key', async () => {
    const guard = buildGuard(30, 60_000);
    const context = buildContext();
    (context.switchToHttp().getRequest() as any).headers['x-api-key'] = 'sk_live_1234567890abcdef';

    await expect((guard as any).throwThrottlingException(context)).rejects.toBeInstanceOf(
      HttpException,
    );

    expect((guard as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('apikey:sk_live_'),
      expect.objectContaining({ type: 'external_rate_limit_exceeded' }),
    );
  });
});
