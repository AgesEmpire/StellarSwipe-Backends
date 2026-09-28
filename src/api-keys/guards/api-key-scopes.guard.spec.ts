/**
 * Issue #860 — Implement API key scope validation per endpoint
 *
 * Unit tests for ApiKeyScopesGuard:
 *   - Correct scope granted → allowed
 *   - Missing scope → 403 Forbidden
 *   - Admin wildcard scope → always allowed
 *   - No @RequireScopes on route → allowed (guard is a no-op)
 *   - No API key on request → 401 Unauthorized
 */
import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyScopesGuard } from './api-key-scopes.guard';
import { ApiKeyScope } from '../enums/api-key-scope.enum';
import { API_KEY_SCOPES_METADATA } from '../decorators/require-scopes.decorator';

const makeContext = (
  apiKey: any,
  requiredScopes: ApiKeyScope[] | undefined,
): ExecutionContext => {
  const request = { apiKey };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
};

const makeReflector = (scopes: ApiKeyScope[] | undefined): Reflector =>
  ({
    getAllAndOverride: jest.fn().mockReturnValue(scopes),
  }) as unknown as Reflector;

const makeApiKeysService = () => ({}) as any;

describe('ApiKeyScopesGuard (Issue #860)', () => {
  it('allows when no scopes are required on the route', async () => {
    const guard = new ApiKeyScopesGuard(
      makeReflector(undefined),
      makeApiKeysService(),
    );
    const ctx = makeContext({ id: 'key-1', scopes: [] }, undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows when required scopes are an empty array', async () => {
    const guard = new ApiKeyScopesGuard(
      makeReflector([]),
      makeApiKeysService(),
    );
    const ctx = makeContext({ id: 'key-1', scopes: [] }, []);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows when key has the required scope', async () => {
    const guard = new ApiKeyScopesGuard(
      makeReflector([ApiKeyScope.TRADES_WRITE]),
      makeApiKeysService(),
    );
    const ctx = makeContext(
      { id: 'key-1', scopes: [ApiKeyScope.TRADES_WRITE] },
      [ApiKeyScope.TRADES_WRITE],
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows when key has the ADMIN wildcard scope regardless of required scopes', async () => {
    const guard = new ApiKeyScopesGuard(
      makeReflector([ApiKeyScope.TRADES_WRITE, ApiKeyScope.SIGNALS_READ]),
      makeApiKeysService(),
    );
    const ctx = makeContext({ id: 'key-1', scopes: [ApiKeyScope.ADMIN] }, [
      ApiKeyScope.TRADES_WRITE,
      ApiKeyScope.SIGNALS_READ,
    ]);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws ForbiddenException when key is missing a required scope', async () => {
    const guard = new ApiKeyScopesGuard(
      makeReflector([ApiKeyScope.TRADES_WRITE]),
      makeApiKeysService(),
    );
    // Key only has signals:read — missing trades:write
    const ctx = makeContext(
      { id: 'key-1', scopes: [ApiKeyScope.SIGNALS_READ] },
      [ApiKeyScope.TRADES_WRITE],
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException listing all missing scopes in the message', async () => {
    const guard = new ApiKeyScopesGuard(
      makeReflector([ApiKeyScope.TRADES_WRITE, ApiKeyScope.SIGNALS_WRITE]),
      makeApiKeysService(),
    );
    const ctx = makeContext({ id: 'key-1', scopes: [] }, [
      ApiKeyScope.TRADES_WRITE,
      ApiKeyScope.SIGNALS_WRITE,
    ]);
    try {
      await guard.canActivate(ctx);
      fail('Expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).message).toContain(
        ApiKeyScope.TRADES_WRITE,
      );
      expect((err as ForbiddenException).message).toContain(
        ApiKeyScope.SIGNALS_WRITE,
      );
    }
  });

  it('throws UnauthorizedException when no API key is present on the request', async () => {
    const guard = new ApiKeyScopesGuard(
      makeReflector([ApiKeyScope.TRADES_WRITE]),
      makeApiKeysService(),
    );
    const ctx = makeContext(undefined, [ApiKeyScope.TRADES_WRITE]);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws ForbiddenException for GET /signals with key that only has trades:write', async () => {
    const guard = new ApiKeyScopesGuard(
      makeReflector([ApiKeyScope.SIGNALS_READ]),
      makeApiKeysService(),
    );
    const ctx = makeContext(
      { id: 'key-1', scopes: [ApiKeyScope.TRADES_WRITE] },
      [ApiKeyScope.SIGNALS_READ],
    );
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows GET /signals when key has signals:read scope', async () => {
    const guard = new ApiKeyScopesGuard(
      makeReflector([ApiKeyScope.SIGNALS_READ]),
      makeApiKeysService(),
    );
    const ctx = makeContext(
      { id: 'key-1', scopes: [ApiKeyScope.SIGNALS_READ] },
      [ApiKeyScope.SIGNALS_READ],
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
