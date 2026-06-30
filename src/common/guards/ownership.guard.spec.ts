import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { OwnershipGuard } from './ownership.guard';
import { OWNERSHIP_KEY } from '../decorators/check-ownership.decorator';

class FakeEntity {
  id!: string;
  userId!: string;
}

function makeContext(overrides: {
  params?: Record<string, string>;
  userId?: string;
  metadata?: any;
}): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({
        params: overrides.params ?? {},
        user: overrides.userId ? { id: overrides.userId } : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('OwnershipGuard', () => {
  let guard: OwnershipGuard;
  let reflector: Reflector;
  let mockFindOne: jest.Mock;

  beforeEach(async () => {
    mockFindOne = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OwnershipGuard,
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn() },
        },
        {
          provide: getDataSourceToken(),
          useValue: {
            getRepository: () => ({ findOne: mockFindOne }),
          },
        },
      ],
    }).compile();

    guard = module.get(OwnershipGuard);
    reflector = module.get(Reflector);
  });

  it('allows access when no ownership metadata is set', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);
    const ctx = makeContext({ userId: 'user-1' });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('allows access when authenticated user owns the resource', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue({
      routeParam: 'id',
      entity: FakeEntity,
    });
    mockFindOne.mockResolvedValue({ id: 'res-1', userId: 'user-1' });

    const ctx = makeContext({ params: { id: 'res-1' }, userId: 'user-1', metadata: OWNERSHIP_KEY });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('throws ForbiddenException when user does not own the resource', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue({
      routeParam: 'id',
      entity: FakeEntity,
    });
    mockFindOne.mockResolvedValue({ id: 'res-1', userId: 'other-user' });

    const ctx = makeContext({ params: { id: 'res-1' }, userId: 'user-1' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('throws NotFoundException when resource does not exist', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue({
      routeParam: 'id',
      entity: FakeEntity,
    });
    mockFindOne.mockResolvedValue(null);

    const ctx = makeContext({ params: { id: 'missing' }, userId: 'user-1' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when no authenticated user', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue({
      routeParam: 'id',
      entity: FakeEntity,
    });

    const ctx = makeContext({ params: { id: 'res-1' }, userId: undefined });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
