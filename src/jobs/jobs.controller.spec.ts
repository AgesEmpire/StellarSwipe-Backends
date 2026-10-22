import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';
import { UserRole } from '../authorization/entities/user-role.entity';
import { ROLES_KEY } from '../authorization/decorators/roles.decorator';
import { RolesGuard } from '../authorization/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JobsController } from './jobs.controller';

describe('JobsController queue cancellation authorization', () => {
  const cancelHandler = JobsController.prototype.cancelQueueJob;

  it('requires JWT authentication and the admin role for cancellation', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      cancelHandler,
    ) as Function[];

    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
    expect(Reflect.getMetadata(ROLES_KEY, cancelHandler)).toEqual(['admin']);
  });

  it('denies an authenticated caller without the admin role', async () => {
    const roleRepository = {
      find: jest.fn().mockResolvedValue([]),
    } as unknown as Repository<UserRole>;
    const guard = new RolesGuard(new Reflector(), roleRepository);
    const context = {
      getHandler: () => cancelHandler,
      getClass: () => JobsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'user-1' } }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows an authenticated caller with the admin role', async () => {
    const roleRepository = {
      find: jest.fn().mockResolvedValue([
        {
          isActive: () => true,
          role: { name: 'admin' },
        },
      ]),
    } as unknown as Repository<UserRole>;
    const guard = new RolesGuard(new Reflector(), roleRepository);
    const context = {
      getHandler: () => cancelHandler,
      getClass: () => JobsController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'admin-1' } }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
