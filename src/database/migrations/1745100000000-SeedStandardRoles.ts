import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Seeds the standard RBAC roles: admin, trader, viewer.
 * Permissions are inserted first, then roles, then the join table entries.
 * Uses INSERT ... ON CONFLICT DO NOTHING for idempotency.
 */
export class SeedStandardRoles1745100000000 implements MigrationInterface {
  name = 'SeedStandardRoles1745100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Permissions ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO permissions (id, name, "displayName", category, level, "isActive", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), 'trades:read',        'View Trades',         'trading',         'read',   true, NOW(), NOW()),
        (gen_random_uuid(), 'trades:write',       'Execute Trades',      'trading',         'write',  true, NOW(), NOW()),
        (gen_random_uuid(), 'signals:read',       'View Signals',        'trading',         'read',   true, NOW(), NOW()),
        (gen_random_uuid(), 'signals:write',      'Create Signals',      'trading',         'write',  true, NOW(), NOW()),
        (gen_random_uuid(), 'analytics:read',     'View Analytics',      'analytics',       'read',   true, NOW(), NOW()),
        (gen_random_uuid(), 'analytics:write',    'Manage Analytics',    'analytics',       'write',  true, NOW(), NOW()),
        (gen_random_uuid(), 'users:read',         'View Users',          'user_management', 'read',   true, NOW(), NOW()),
        (gen_random_uuid(), 'users:write',        'Manage Users',        'user_management', 'write',  true, NOW(), NOW()),
        (gen_random_uuid(), 'users:delete',       'Delete Users',        'user_management', 'delete', true, NOW(), NOW()),
        (gen_random_uuid(), 'roles:read',         'View Roles',          'system',          'read',   true, NOW(), NOW()),
        (gen_random_uuid(), 'roles:create',       'Create Roles',        'system',          'write',  true, NOW(), NOW()),
        (gen_random_uuid(), 'roles:update',       'Update Roles',        'system',          'write',  true, NOW(), NOW()),
        (gen_random_uuid(), 'roles:delete',       'Delete Roles',        'system',          'delete', true, NOW(), NOW()),
        (gen_random_uuid(), 'permissions:read',   'View Permissions',    'system',          'read',   true, NOW(), NOW()),
        (gen_random_uuid(), 'permissions:assign', 'Assign Permissions',  'system',          'admin',  true, NOW(), NOW()),
        (gen_random_uuid(), 'permissions:check',  'Check Permissions',   'system',          'read',   true, NOW(), NOW()),
        (gen_random_uuid(), 'user-roles:read',    'View User Roles',     'user_management', 'read',   true, NOW(), NOW()),
        (gen_random_uuid(), 'user-roles:assign',  'Assign User Roles',   'user_management', 'admin',  true, NOW(), NOW()),
        (gen_random_uuid(), 'user-roles:revoke',  'Revoke User Roles',   'user_management', 'admin',  true, NOW(), NOW()),
        (gen_random_uuid(), 'system:admin',       'Full System Access',  'system',          'admin',  true, NOW(), NOW())
      ON CONFLICT (name) DO NOTHING
    `);

    // ── Roles ────────────────────────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO roles (id, name, description, type, scope, "isActive", priority, "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), 'admin',  'Full system access — can manage users, roles, and all resources', 'system', 'global', true, 100, NOW(), NOW()),
        (gen_random_uuid(), 'trader', 'Can execute trades, view signals, and access analytics',          'custom', 'global', true,  50, NOW(), NOW()),
        (gen_random_uuid(), 'viewer', 'Read-only access to trades, signals, and analytics',              'custom', 'global', true,  10, NOW(), NOW())
      ON CONFLICT (name) DO NOTHING
    `);

    // ── Role-Permission assignments ───────────────────────────────────────────
    // admin gets all permissions
    await queryRunner.query(`
      INSERT INTO role_permissions ("roleId", "permissionId")
      SELECT r.id, p.id
      FROM roles r, permissions p
      WHERE r.name = 'admin'
      ON CONFLICT DO NOTHING
    `);

    // trader permissions
    await queryRunner.query(`
      INSERT INTO role_permissions ("roleId", "permissionId")
      SELECT r.id, p.id
      FROM roles r
      JOIN permissions p ON p.name IN ('trades:read','trades:write','signals:read','signals:write','analytics:read')
      WHERE r.name = 'trader'
      ON CONFLICT DO NOTHING
    `);

    // viewer permissions
    await queryRunner.query(`
      INSERT INTO role_permissions ("roleId", "permissionId")
      SELECT r.id, p.id
      FROM roles r
      JOIN permissions p ON p.name IN ('trades:read','signals:read','analytics:read')
      WHERE r.name = 'viewer'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM role_permissions WHERE "roleId" IN (SELECT id FROM roles WHERE name IN ('admin','trader','viewer'))`);
    await queryRunner.query(`DELETE FROM roles WHERE name IN ('admin','trader','viewer')`);
    await queryRunner.query(`
      DELETE FROM permissions WHERE name IN (
        'trades:read','trades:write','signals:read','signals:write',
        'analytics:read','analytics:write','users:read','users:write','users:delete',
        'roles:read','roles:create','roles:update','roles:delete',
        'permissions:read','permissions:assign','permissions:check',
        'user-roles:read','user-roles:assign','user-roles:revoke','system:admin'
      )
    `);
  }
}
