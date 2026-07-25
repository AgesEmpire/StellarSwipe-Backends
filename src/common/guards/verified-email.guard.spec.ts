import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { VerifiedEmailGuard } from './verified-email.guard';
import { REQUIRE_VERIFIED_EMAIL_KEY } from '../decorators/require-verified-email.decorator';

function makeContext(user: any, handlerMeta: boolean | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('VerifiedEmailGuard', () => {
  let guard: VerifiedEmailGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new VerifiedEmailGuard(reflector);
  });

  it('allows the request when the decorator is not present', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeContext({ emailVerified: false }, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows a verified user when the decorator is present', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeContext({ id: 'u1', emailVerified: true }, true);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects an unverified user with ForbiddenException', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeContext({ id: 'u1', emailVerified: false }, true);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when user is absent (guard composed without auth guard)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeContext(undefined, true);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('error message contains EMAIL_NOT_VERIFIED code for unverified user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeContext({ id: 'u1', emailVerified: false }, true);
    try {
      guard.canActivate(ctx);
    } catch (err) {
      expect((err as ForbiddenException).message).toContain('EMAIL_NOT_VERIFIED');
    }
  });
});
