import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from '../../authorization/entities/user-role.entity';
import { AssignmentStatus } from '../../authorization/entities/user-role.entity';

/**
 * @deprecated Use RolesGuard with @Roles('admin') instead.
 */
@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.id) {
      throw new ForbiddenException('User authentication required for admin access');
    }

    const userRoles = await this.userRoleRepository.find({
      where: { userId: user.id, status: AssignmentStatus.ACTIVE },
      relations: ['role'],
    });

    const hasAdminRole = userRoles.some(
      (ur) => ur.isActive() && (ur.role?.name === 'admin' || ur.role?.name === 'ADMIN'),
    );

    if (!hasAdminRole) {
      throw new ForbiddenException('Administrative privileges required');
    }

    return true;
  }
}
