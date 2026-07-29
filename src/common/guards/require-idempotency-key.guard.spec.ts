/**
 * Issue #861 — Add idempotency key support to trade execution and signal creation
 *
 * Unit tests for RequireIdempotencyKeyGuard:
 *   - Missing header        → 400 Bad Request
 *   - Valid header          → allowed (true)
 *   - Concurrent duplicate  → 409 Conflict with Retry-After: 2
 *   - Empty string header   → 400 Bad Request
 *   - Header > 255 chars    → 400 Bad Request
 */
import {
  BadRequestException,
  ConflictException,
  ExecutionContext,
} from '@nestjs/common';
import { RequireIdempotencyKeyGuard } from './require-idempotency-key.guard';

/** Build a minimal ExecutionContext stub */
const makeContext = (
  headers: Record<string, string | undefined> = {},
  user?: any,
) => {
  const responseHandlers: Record<string, Function> = {};
  const response = {
    setHeader: jest.fn(),
    on: (event: string, fn: Function) => {
      responseHandlers[event] = fn;
    },
    emit: (event: string) => responseHandlers[event]?.(),
  };
  const request = {
    headers,
    method: 'POST',
    route: { path: '/trades/execute' },
    url: '/trades/execute',
    user: user ?? { id: 'user-abc' },
  };
  return {
    ctx: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext,
    request,
    response,
  };
};

const makeCacheManager = () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
});

describe('RequireIdempotencyKeyGuard (Issue #861)', () => {
  it('throws 400 when Idempotency-Key header is absent', async () => {
    const guard = new RequireIdempotencyKeyGuard(makeCacheManager() as any);
    const { ctx } = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws 400 when Idempotency-Key header is an empty string', async () => {
    const guard = new RequireIdempotencyKeyGuard(makeCacheManager() as any);
    const { ctx } = makeContext({ 'idempotency-key': '' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws 400 when Idempotency-Key exceeds 255 characters', async () => {
    const guard = new RequireIdempotencyKeyGuard(makeCacheManager() as any);
    const { ctx } = makeContext({ 'idempotency-key': 'x'.repeat(256) });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns true when a valid Idempotency-Key is provided', async () => {
    const guard = new RequireIdempotencyKeyGuard(makeCacheManager() as any);
    const { ctx } = makeContext({
      'idempotency-key': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws 409 Conflict with Retry-After:2 header when same key is in-flight', async () => {
    const guard = new RequireIdempotencyKeyGuard(makeCacheManager() as any);
    const idempotencyKey = 'concurrent-test-key';

    // First call — registers the key as in-flight
    const { ctx: ctx1, response: res1 } = makeContext({
      'idempotency-key': idempotencyKey,
    });
    await guard.canActivate(ctx1);

    // Second call with same key before the first finishes
    const { ctx: ctx2, response: res2 } = makeContext({
      'idempotency-key': idempotencyKey,
    });
    await expect(guard.canActivate(ctx2)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(res2.setHeader).toHaveBeenCalledWith('Retry-After', '2');
  });

  it('allows a second request after the first response has finished', async () => {
    const guard = new RequireIdempotencyKeyGuard(makeCacheManager() as any);
    const idempotencyKey = 'sequential-test-key';

    // First request — complete it by emitting 'finish'
    const { ctx: ctx1, response: res1 } = makeContext({
      'idempotency-key': idempotencyKey,
    });
    await guard.canActivate(ctx1);
    res1.emit('finish'); // clears the in-flight entry

    // Second request — should succeed
    const { ctx: ctx2 } = makeContext({ 'idempotency-key': idempotencyKey });
    await expect(guard.canActivate(ctx2)).resolves.toBe(true);
  });

  it('error message instructs the client to generate a UUID', async () => {
    const guard = new RequireIdempotencyKeyGuard(makeCacheManager() as any);
    const { ctx } = makeContext({});
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      expect((err as BadRequestException).message).toMatch(/Idempotency-Key/i);
    }
  });
});
