import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../entities/user-role.entity';
import { AssignmentStatus } from '../entities/user-role.entity';

/**
 * RolesGuard — enforces role-name-based access control.
 *
 * Checks that the authenticated user holds at least one of the roles
 * listed in @Roles(). Complements PermissionsGuard for coarse-grained
 * role checks (admin, trader, viewer, etc.).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.id) {
      throw new ForbiddenException('User not authenticated');
    }

    const userRoles = await this.userRoleRepository.find({
      where: { userId: user.id, status: AssignmentStatus.ACTIVE },
      relations: ['role'],
    });

    const activeRoleNames = userRoles
      .filter((ur) => ur.isActive())
      .map((ur) => ur.role?.name)
      .filter(Boolean);

    const hasRole = requiredRoles.some((r) => activeRoleNames.includes(r));

    if (!hasRole) {
      throw new ForbiddenException(
        `Access denied. Required role(s): ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
