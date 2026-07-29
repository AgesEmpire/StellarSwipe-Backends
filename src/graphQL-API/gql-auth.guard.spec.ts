import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Reflector } from '@nestjs/core';
import { GqlAuthGuard } from './gql-auth.guard';

/**
 * `GqlAuthGuard` wraps Passport's `AuthGuard('jwt')`, which is only
 * meaningful for HTTP query/mutation operations (it needs a real `req` to
 * extract a bearer token from). For `graphql-ws` subscription operations
 * there is no `req` — the connection was already authenticated once, at
 * handshake time, by `GraphqlModule`'s `onConnect` hook (see
 * `ws-subscription-auth.ts`), and the resulting user is merged into the
 * per-operation context as `context.user`.
 *
 * These tests cover the guard's subscription branch: it must allow a
 * request through when a WS-authenticated user is present on the context,
 * and deny it (without attempting to re-run Passport against a
 * nonexistent request) when it isn't.
 */
describe('GqlAuthGuard (subscription/WS context handling)', () => {
  let guard: GqlAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };

  function buildExecutionContext(gqlContext: Record<string, unknown>): ExecutionContext {
    const execContext = {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;

    jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getContext: () => gqlContext,
    } as unknown as GqlExecutionContext);

    return execContext;
  }

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    guard = new GqlAuthGuard(reflector as unknown as Reflector);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows the request through when the route is decorated with @Public()', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = buildExecutionContext({});

    expect(guard.canActivate(context)).toBe(true);
  });

  it('authorizes a subscription operation whose WS connection already resolved a user', () => {
    // No `req` — this is what a graphql-ws subscription operation's context
    // looks like once `onConnect` has run successfully.
    const context = buildExecutionContext({ user: { id: 'user-1' } });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies a subscription operation whose WS connection has no authenticated user', () => {
    // No `req` and no `user` — the handshake either never ran or failed to
    // attach a user; the guard must reject this instead of crashing while
    // looking for a nonexistent `req`.
    const context = buildExecutionContext({});

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('falls through to Passport-based auth when an HTTP `req` is present (query/mutation)', () => {
    const fakeReq = { headers: { authorization: 'Bearer token' } };
    const context = buildExecutionContext({ req: fakeReq });
    const superSpy = jest
      .spyOn(Object.getPrototypeOf(GqlAuthGuard.prototype), 'canActivate')
      .mockReturnValue(true);

    const result = guard.canActivate(context);

    expect(superSpy).toHaveBeenCalledWith(context);
    expect(result).toBe(true);
  });
});
