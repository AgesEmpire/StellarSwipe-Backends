import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { ApiKeysService } from '../api-keys.service';

function mockContext(authHeader?: string, handler?: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization: authHeader },
        method: 'GET',
        path: '/test',
      }),
    }),
    getHandler: () => handler ?? (() => {}),
  } as any;
}

describe('ApiKeyAuthGuard', () => {
  let guard: ApiKeyAuthGuard;
  let apiKeysService: jest.Mocked<ApiKeysService>;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    apiKeysService = {
      verify: jest.fn(),
      checkRateLimit: jest.fn(),
      trackUsage: jest.fn(),
    } as any;

    reflector = { get: jest.fn() } as any;
    guard = new ApiKeyAuthGuard(apiKeysService, reflector);
    jest.spyOn((guard as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((guard as any).logger, 'debug').mockImplementation(() => {});
  });

  it('throws UnauthorizedException for missing/invalid header format', async () => {
    await expect(guard.canActivate(mockContext('Bearer jwt-token'))).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(guard.canActivate(mockContext(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('allows valid key with no scope requirements', async () => {
    const apiKey = { id: 'k1', userId: 'u1', scopes: ['read:signals'], rateLimit: 1000 };
    apiKeysService.verify.mockResolvedValue(apiKey as any);
    apiKeysService.checkRateLimit.mockResolvedValue(true);
    reflector.get.mockReturnValue(undefined);
    apiKeysService.trackUsage.mockResolvedValue(undefined);

    const result = await guard.canActivate(mockContext('Bearer sk_live_abc'));
    expect(result).toBe(true);
  });

  it('throws ForbiddenException when rate limit exceeded', async () => {
    const apiKey = { id: 'k1', userId: 'u1', scopes: [], rateLimit: 100 };
    apiKeysService.verify.mockResolvedValue(apiKey as any);
    apiKeysService.checkRateLimit.mockResolvedValue(false);

    await expect(guard.canActivate(mockContext('Bearer sk_live_abc'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when required scope is missing', async () => {
    const apiKey = { id: 'k1', userId: 'u1', scopes: ['read:signals'], rateLimit: 1000 };
    apiKeysService.verify.mockResolvedValue(apiKey as any);
    apiKeysService.checkRateLimit.mockResolvedValue(true);
    reflector.get.mockReturnValue(['write:trades']);

    await expect(guard.canActivate(mockContext('Bearer sk_live_abc'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows when key has required scope', async () => {
    const apiKey = { id: 'k1', userId: 'u1', scopes: ['read:signals', 'write:trades'], rateLimit: 1000 };
    apiKeysService.verify.mockResolvedValue(apiKey as any);
    apiKeysService.checkRateLimit.mockResolvedValue(true);
    reflector.get.mockReturnValue(['write:trades']);
    apiKeysService.trackUsage.mockResolvedValue(undefined);

    const result = await guard.canActivate(mockContext('Bearer sk_live_abc'));
    expect(result).toBe(true);
  });

  it('tracks usage on successful auth', async () => {
    const apiKey = { id: 'k1', userId: 'u1', scopes: [], rateLimit: 1000 };
    apiKeysService.verify.mockResolvedValue(apiKey as any);
    apiKeysService.checkRateLimit.mockResolvedValue(true);
    reflector.get.mockReturnValue(undefined);
    apiKeysService.trackUsage.mockResolvedValue(undefined);

    await guard.canActivate(mockContext('Bearer sk_live_abc'));

    expect(apiKeysService.trackUsage).toHaveBeenCalledWith('k1', 'GET:/test', false);
  });
});
