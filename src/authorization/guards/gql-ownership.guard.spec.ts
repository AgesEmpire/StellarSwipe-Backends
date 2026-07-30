import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { Reflector } from '@nestjs/core';
import { GqlOwnershipGuard } from './gql-ownership.guard';
import { ForbiddenResourceException } from '../../common/exceptions/forbidden-resource.exception';

describe('GqlOwnershipGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };

  function buildExecutionContext(root: unknown, req: unknown): ExecutionContext {
    const execContext = {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;

    jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
      getRoot: () => root,
      getContext: () => ({ req }),
    } as unknown as GqlExecutionContext);

    return execContext;
  }

  afterEach(() => jest.restoreAllMocks());

  it('allows the request through when the field has no @FieldOwner() metadata', () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    const guard = new GqlOwnershipGuard(reflector as unknown as Reflector);
    const context = buildExecutionContext({ userId: 'user-2' }, { user: { id: 'user-1' } });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the request through when the requester owns the parent resource', () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue('userId') };
    const guard = new GqlOwnershipGuard(reflector as unknown as Reflector);
    const context = buildExecutionContext({ userId: 'user-1' }, { user: { id: 'user-1' } });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows an authorized operator to access another account\'s resource', () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue('userId') };
    const guard = new GqlOwnershipGuard(reflector as unknown as Reflector);
    const context = buildExecutionContext(
      { userId: 'user-2' },
      { user: { id: 'admin-1', roles: ['admin'] } },
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenResourceException on cross-account access', () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue('userId') };
    const guard = new GqlOwnershipGuard(reflector as unknown as Reflector);
    const context = buildExecutionContext({ userId: 'user-2' }, { user: { id: 'user-1' } });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenResourceException);
  });

  it('allows through when the parent has no owner reference at all (e.g. public/aggregate type)', () => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue('userId') };
    const guard = new GqlOwnershipGuard(reflector as unknown as Reflector);
    const context = buildExecutionContext({ id: 'agg-1' }, { user: { id: 'user-1' } });

    expect(guard.canActivate(context)).toBe(true);
  });
});
