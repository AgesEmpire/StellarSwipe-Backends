import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { Role, RoleType, RoleScope } from '../../authorization/entities/role.entity';
import { Permission, PermissionCategory, PermissionLevel } from '../../authorization/entities/permission.entity';

const logger = new Logger('RbacSeed');

/**
 * Seeds the standard RBAC roles (admin, trader, viewer) and their permissions.
 * Safe to run multiple times — uses upsert semantics.
 */
export async function seedRbac(dataSource: DataSource): Promise<void> {
  const permRepo = dataSource.getRepository(Permission);
  const roleRepo = dataSource.getRepository(Role);

  // ── Permissions ────────────────────────────────────────────────────────────
  const permDefs: Partial<Permission>[] = [
    // Trading
    { name: 'trades:read',   displayName: 'View Trades',    category: PermissionCategory.TRADING,  level: PermissionLevel.READ  },
    { name: 'trades:write',  displayName: 'Execute Trades', category: PermissionCategory.TRADING,  level: PermissionLevel.WRITE },
    { name: 'signals:read',  displayName: 'View Signals',   category: PermissionCategory.TRADING,  level: PermissionLevel.READ  },
    { name: 'signals:write', displayName: 'Create Signals', category: PermissionCategory.TRADING,  level: PermissionLevel.WRITE },
    // Analytics
    { name: 'analytics:read',  displayName: 'View Analytics',  category: PermissionCategory.ANALYTICS, level: PermissionLevel.READ  },
    { name: 'analytics:write', displayName: 'Manage Analytics', category: PermissionCategory.ANALYTICS, level: PermissionLevel.WRITE },
    // User management
    { name: 'users:read',   displayName: 'View Users',   category: PermissionCategory.USER_MANAGEMENT, level: PermissionLevel.READ   },
    { name: 'users:write',  displayName: 'Manage Users', category: PermissionCategory.USER_MANAGEMENT, level: PermissionLevel.WRITE  },
    { name: 'users:delete', displayName: 'Delete Users', category: PermissionCategory.USER_MANAGEMENT, level: PermissionLevel.DELETE },
    // Roles
    { name: 'roles:read',   displayName: 'View Roles',   category: PermissionCategory.SYSTEM, level: PermissionLevel.READ   },
    { name: 'roles:create', displayName: 'Create Roles', category: PermissionCategory.SYSTEM, level: PermissionLevel.WRITE  },
    { name: 'roles:update', displayName: 'Update Roles', category: PermissionCategory.SYSTEM, level: PermissionLevel.WRITE  },
    { name: 'roles:delete', displayName: 'Delete Roles', category: PermissionCategory.SYSTEM, level: PermissionLevel.DELETE },
    // Permissions
    { name: 'permissions:read',   displayName: 'View Permissions',   category: PermissionCategory.SYSTEM, level: PermissionLevel.READ  },
    { name: 'permissions:assign', displayName: 'Assign Permissions', category: PermissionCategory.SYSTEM, level: PermissionLevel.ADMIN },
    { name: 'permissions:check',  displayName: 'Check Permissions',  category: PermissionCategory.SYSTEM, level: PermissionLevel.READ  },
    // User-roles
    { name: 'user-roles:read',   displayName: 'View User Roles',   category: PermissionCategory.USER_MANAGEMENT, level: PermissionLevel.READ  },
    { name: 'user-roles:assign', displayName: 'Assign User Roles', category: PermissionCategory.USER_MANAGEMENT, level: PermissionLevel.ADMIN },
    { name: 'user-roles:revoke', displayName: 'Revoke User Roles', category: PermissionCategory.USER_MANAGEMENT, level: PermissionLevel.ADMIN },
    // System
    { name: 'system:admin', displayName: 'Full System Access', category: PermissionCategory.SYSTEM, level: PermissionLevel.ADMIN },
  ];

  const savedPerms: Record<string, Permission> = {};
  for (const def of permDefs) {
    const existing = await permRepo.findOne({ where: { name: def.name } });
    if (existing) {
      savedPerms[def.name!] = existing;
    } else {
      savedPerms[def.name!] = await permRepo.save(permRepo.create(def));
    }
  }

  // ── Roles ──────────────────────────────────────────────────────────────────
  const roleDefs: Array<{ name: string; description: string; permissions: string[] }> = [
    {
      name: 'admin',
      description: 'Full system access — can manage users, roles, and all resources',
      permissions: Object.keys(savedPerms),
    },
    {
      name: 'trader',
      description: 'Can execute trades, view signals, and access analytics',
      permissions: ['trades:read', 'trades:write', 'signals:read', 'signals:write', 'analytics:read'],
    },
    {
      name: 'viewer',
      description: 'Read-only access to trades, signals, and analytics',
      permissions: ['trades:read', 'signals:read', 'analytics:read'],
    },
  ];

  for (const def of roleDefs) {
    let role = await roleRepo.findOne({ where: { name: def.name }, relations: ['permissions'] });
    if (!role) {
      role = roleRepo.create({
        name: def.name,
        description: def.description,
        type: def.name === 'admin' ? RoleType.SYSTEM : RoleType.CUSTOM,
        scope: RoleScope.GLOBAL,
        isActive: true,
        priority: def.name === 'admin' ? 100 : def.name === 'trader' ? 50 : 10,
      });
    }
    role.permissions = def.permissions.map((p) => savedPerms[p]).filter(Boolean);
    await roleRepo.save(role);
  }

  logger.log('RBAC seed complete: admin, trader, viewer roles created/updated');
}
