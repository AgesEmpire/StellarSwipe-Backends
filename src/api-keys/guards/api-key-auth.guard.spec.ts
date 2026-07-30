import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { ApiKeysService } from '../api-keys.service';

function mockContext(
  headers: Record<string, string> = {},
  query: Record<string, string> = {},
  handler?: any,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers,
        query,
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

  describe('extractApiKey', () => {
    it('extracts from Authorization header (Bearer sk_live_xxx)', () => {
      const key = guard.extractApiKey({ headers: { authorization: 'Bearer sk_live_abc123' } });
      expect(key).toBe('abc123');
    });

    it('extracts from x-api-key header', () => {
      const key = guard.extractApiKey({ headers: { 'x-api-key': 'sk_live_def456' }, query: {} });
      expect(key).toBe('sk_live_def456');
    });

    it('extracts from api_key query parameter', () => {
      const key = guard.extractApiKey({ headers: {}, query: { api_key: 'sk_live_ghi789' } });
      expect(key).toBe('sk_live_ghi789');
    });

    it('returns null when no API key is provided', () => {
      const key = guard.extractApiKey({ headers: {}, query: {} });
      expect(key).toBeNull();
    });

    it('trims whitespace from extracted keys', () => {
      const key = guard.extractApiKey({ headers: { 'x-api-key': '  sk_live_abc  ' }, query: {} });
      expect(key).toBe('sk_live_abc');
    });
  });

  describe('canActivate', () => {
    it('throws UnauthorizedException when no API key is present', async () => {
      await expect(
        guard.canActivate(mockContext({}, {})),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('allows valid key from Authorization header', async () => {
      const apiKey = { id: 'k1', userId: 'u1', scopes: ['read:signals'], rateLimit: 1000 };
      apiKeysService.verify.mockResolvedValue(apiKey as any);
      apiKeysService.checkRateLimit.mockResolvedValue(true);
      apiKeysService.trackUsage.mockResolvedValue(undefined);

      const result = await guard.canActivate(mockContext({ authorization: 'Bearer sk_live_abc' }));
      expect(result).toBe(true);
      expect(apiKeysService.verify).toHaveBeenCalledWith('abc');
    });

    it('allows valid key from x-api-key header', async () => {
      const apiKey = { id: 'k2', userId: 'u2', scopes: [], rateLimit: 1000 };
      apiKeysService.verify.mockResolvedValue(apiKey as any);
      apiKeysService.checkRateLimit.mockResolvedValue(true);
      apiKeysService.trackUsage.mockResolvedValue(undefined);

      const result = await guard.canActivate(mockContext({ 'x-api-key': 'sk_live_xyz' }));
      expect(result).toBe(true);
    });

    it('allows valid key from api_key query param', async () => {
      const apiKey = { id: 'k3', userId: 'u3', scopes: [], rateLimit: 1000 };
      apiKeysService.verify.mockResolvedValue(apiKey as any);
      apiKeysService.checkRateLimit.mockResolvedValue(true);
      apiKeysService.trackUsage.mockResolvedValue(undefined);

      const result = await guard.canActivate(mockContext({}, { api_key: 'sk_live_query' }));
      expect(result).toBe(true);
    });

    it('throws ForbiddenException when rate limit exceeded', async () => {
      const apiKey = { id: 'k1', userId: 'u1', scopes: [], rateLimit: 100 };
      apiKeysService.verify.mockResolvedValue(apiKey as any);
      apiKeysService.checkRateLimit.mockResolvedValue(false);

      await expect(
        guard.canActivate(mockContext({ authorization: 'Bearer sk_live_abc' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('sets request.apiKey and request.userId on success', async () => {
      const apiKey = { id: 'k1', userId: 'u1', scopes: [], rateLimit: 1000 };
      apiKeysService.verify.mockResolvedValue(apiKey as any);
      apiKeysService.checkRateLimit.mockResolvedValue(true);
      apiKeysService.trackUsage.mockResolvedValue(undefined);

      const context = mockContext({ 'x-api-key': 'sk_live_abc' });
      await guard.canActivate(context);
      const req = context.switchToHttp().getRequest();
      expect(req.apiKey).toEqual(apiKey);
      expect(req.userId).toBe('u1');
    });

    it('tracks usage on successful auth', async () => {
      const apiKey = { id: 'k1', userId: 'u1', scopes: [], rateLimit: 1000 };
      apiKeysService.verify.mockResolvedValue(apiKey as any);
      apiKeysService.checkRateLimit.mockResolvedValue(true);
      apiKeysService.trackUsage.mockResolvedValue(undefined);

      await guard.canActivate(mockContext({ authorization: 'Bearer sk_live_abc' }));
      expect(apiKeysService.trackUsage).toHaveBeenCalledWith('k1', 'GET:/test', false);
    });
  });
});
