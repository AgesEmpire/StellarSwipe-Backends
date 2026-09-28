import { Reflector } from '@nestjs/core';
import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { VerifiedEmailGuard } from './verified-email.guard';
import { REQUIRE_VERIFIED_EMAIL_KEY } from '../decorators/require-verified-email.decorator';
import {
  EMAIL_NOT_VERIFIED_ERROR_CODE,
  EmailNotVerifiedException,
} from '../exceptions/email-not-verified.exception';

function makeContext(user: unknown): ExecutionContext {
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

  it('allows the request when @RequireVerifiedEmail() is not present (opt-in behavior)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeContext({ id: 'u1', emailVerified: false });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows a verified user when the decorator is present', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeContext({ id: 'u1', emailVerified: true });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects an unverified user with a typed EmailNotVerifiedException (HTTP 403 + error code)', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeContext({ id: 'u1', emailVerified: false });

    expect(() => guard.canActivate(ctx)).toThrow(EmailNotVerifiedException);

    try {
      guard.canActivate(ctx);
      fail('expected canActivate to throw');
    } catch (err) {
      const exception = err as EmailNotVerifiedException;
      expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN);
      const response = exception.getResponse() as Record<string, unknown>;
      expect(response.code).toBe(EMAIL_NOT_VERIFIED_ERROR_CODE);
    }
  });

  it('defers to the authentication guard when req.user is absent, instead of duplicating its rejection', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeContext(undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('reads metadata from both the handler and the class so controller-level usage works', () => {
    const spy = jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(true);
    const ctx = makeContext({ id: 'u1', emailVerified: true });

    guard.canActivate(ctx);

    expect(spy).toHaveBeenCalledWith(REQUIRE_VERIFIED_EMAIL_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
  });
});
