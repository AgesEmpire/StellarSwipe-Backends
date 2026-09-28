import { Injectable } from '@nestjs/common';
import { Permission, PermissionCategory } from './entities/permission.entity';
import {
  PERMISSION_MATRIX,
  PERMISSION_LEVEL_ORDER,
  RoleArchetype,
} from './permission-matrix';

export interface PermissionMatrixViolation {
  permissionName: string;
  category: PermissionCategory;
  requiredLevel: string;
  maxAllowedLevel: string | null;
}

/**
 * Enforces `PERMISSION_MATRIX` against role/permission assignments.
 *
 * Only roles whose name matches a known archetype (admin, support,
 * service_account — case-insensitive) are constrained; custom/team roles
 * are unaffected, since the matrix documents fixed archetypes, not every
 * possible custom role a team might create.
 */
@Injectable()
export class PermissionMatrixService {
  resolveArchetype(roleName: string): RoleArchetype | null {
    const normalized = roleName?.trim().toLowerCase();
    switch (normalized) {
      case RoleArchetype.ADMIN:
        return RoleArchetype.ADMIN;
      case RoleArchetype.SUPPORT:
        return RoleArchetype.SUPPORT;
      case RoleArchetype.SERVICE_ACCOUNT:
        return RoleArchetype.SERVICE_ACCOUNT;
      default:
        return null;
    }
  }

  /**
   * Returns every permission that exceeds what the matrix allows for the
   * given role name's archetype. An empty array means the assignment is
   * consistent with the matrix (or the role isn't a recognized archetype).
   */
  findViolations(
    roleName: string,
    permissions: Pick<Permission, 'name' | 'category' | 'level'>[],
  ): PermissionMatrixViolation[] {
    const archetype = this.resolveArchetype(roleName);
    if (!archetype) {
      return [];
    }

    const ceiling = PERMISSION_MATRIX[archetype];
    const violations: PermissionMatrixViolation[] = [];

    for (const permission of permissions) {
      const maxAllowedLevel = ceiling[permission.category] ?? null;

      if (
        maxAllowedLevel === null ||
        PERMISSION_LEVEL_ORDER.indexOf(permission.level) >
          PERMISSION_LEVEL_ORDER.indexOf(maxAllowedLevel)
      ) {
        violations.push({
          permissionName: permission.name,
          category: permission.category,
          requiredLevel: permission.level,
          maxAllowedLevel,
        });
      }
    }

    return violations;
  }
}
