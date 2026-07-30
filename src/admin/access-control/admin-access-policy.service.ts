import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AssignmentStatus,
  UserRole,
} from '../../authorization/entities/user-role.entity';

export type AdminPermissionAction = 'read' | 'write' | 'delete';

export interface AdminPrincipal {
  id?: string;
  userId?: string;
}

@Injectable()
export class AdminAccessPolicyService {
  constructor(
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
  ) {}

  async assertCanAccessAdminRoute(
    principal: AdminPrincipal | undefined,
    method: string,
  ): Promise<void> {
    const userId = principal?.id ?? principal?.userId;
    if (!userId) {
      throw new ForbiddenException('User authentication required for admin access');
    }

    const assignments = await this.userRoleRepository.find({
      where: { userId, status: AssignmentStatus.ACTIVE },
      relations: ['role', 'role.permissions'],
    });

    const activeAssignments = assignments.filter((assignment) =>
      assignment.isActive(),
    );
    const hasAdminRole = activeAssignments.some((assignment) =>
      this.isAdminRole(assignment.role?.name),
    );

    if (!hasAdminRole) {
      throw new ForbiddenException('Administrative role required');
    }

    const requiredAction = this.requiredActionForMethod(method);
    const permissionNames = activeAssignments.flatMap(
      (assignment) =>
        assignment.role?.permissions
          ?.filter((permission) => permission.isActive !== false)
          .map((permission) => permission.name) ?? [],
    );

    if (!this.hasAdminPermission(permissionNames, requiredAction)) {
      throw new ForbiddenException(
        `Admin permission required: admin:${requiredAction}`,
      );
    }
  }

  private isAdminRole(roleName: string | undefined): boolean {
    if (!roleName) return false;
    const normalized = roleName.toLowerCase().replace(/_/g, '-');
    return normalized === 'admin' || normalized === 'super-admin';
  }

  private requiredActionForMethod(method: string): AdminPermissionAction {
    switch (method.toUpperCase()) {
      case 'GET':
      case 'HEAD':
      case 'OPTIONS':
        return 'read';
      case 'DELETE':
        return 'delete';
      default:
        return 'write';
    }
  }

  private hasAdminPermission(
    permissionNames: string[],
    requiredAction: AdminPermissionAction,
  ): boolean {
    const allowedPermissions = new Set([
      '*',
      '*:*',
      'admin:*',
      'admin:admin',
      `admin:${requiredAction}`,
    ]);

    if (requiredAction === 'read') {
      allowedPermissions.add('admin:write');
      allowedPermissions.add('admin:delete');
    }

    if (requiredAction === 'write') {
      allowedPermissions.add('admin:delete');
    }

    return permissionNames.some((permission) =>
      allowedPermissions.has(permission.toLowerCase()),
    );
  }
}
