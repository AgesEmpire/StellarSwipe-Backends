import { PermissionCategory, PermissionLevel } from './entities/permission.entity';

/**
 * Canonical role archetypes covered by the permission matrix.
 * A `Role` is matched to an archetype by its `name` (see
 * `PermissionMatrixService.resolveArchetype`) — this keeps the matrix
 * decoupled from the free-form custom roles teams create for themselves.
 */
export enum RoleArchetype {
  ADMIN = 'admin',
  SUPPORT = 'support',
  SERVICE_ACCOUNT = 'service_account',
}

/**
 * The maximum `PermissionLevel` each archetype may hold per
 * `PermissionCategory`. `null` means the archetype must never hold any
 * permission in that category.
 *
 * This is the source of truth referenced by `docs/PERMISSION_MATRIX.md` —
 * update both together.
 */
export const PERMISSION_MATRIX: Record<
  RoleArchetype,
  Partial<Record<PermissionCategory, PermissionLevel>>
> = {
  [RoleArchetype.ADMIN]: {
    [PermissionCategory.USER_MANAGEMENT]: PermissionLevel.ADMIN,
    [PermissionCategory.TEAM_MANAGEMENT]: PermissionLevel.ADMIN,
    [PermissionCategory.CONTENT_MANAGEMENT]: PermissionLevel.ADMIN,
    [PermissionCategory.FINANCIAL]: PermissionLevel.ADMIN,
    [PermissionCategory.SYSTEM]: PermissionLevel.ADMIN,
    [PermissionCategory.TRADING]: PermissionLevel.ADMIN,
    [PermissionCategory.ANALYTICS]: PermissionLevel.ADMIN,
    [PermissionCategory.COMPLIANCE]: PermissionLevel.ADMIN,
  },
  [RoleArchetype.SUPPORT]: {
    [PermissionCategory.USER_MANAGEMENT]: PermissionLevel.WRITE,
    [PermissionCategory.CONTENT_MANAGEMENT]: PermissionLevel.WRITE,
    [PermissionCategory.TRADING]: PermissionLevel.READ,
    [PermissionCategory.ANALYTICS]: PermissionLevel.READ,
    [PermissionCategory.COMPLIANCE]: PermissionLevel.READ,
    // No TEAM_MANAGEMENT, FINANCIAL, or SYSTEM access — support cannot
    // change billing, org structure, or infrastructure config.
  },
  [RoleArchetype.SERVICE_ACCOUNT]: {
    [PermissionCategory.TRADING]: PermissionLevel.WRITE,
    [PermissionCategory.ANALYTICS]: PermissionLevel.WRITE,
    [PermissionCategory.SYSTEM]: PermissionLevel.READ,
    // Service accounts are machine callers scoped to trading/analytics
    // pipelines — no access to user PII, financial, team, or compliance data.
  },
};

/**
 * PermissionLevel ordering used to compare a requested level against the
 * matrix ceiling (mirrors `Permission.matchesLevel`).
 */
export const PERMISSION_LEVEL_ORDER: PermissionLevel[] = [
  PermissionLevel.READ,
  PermissionLevel.WRITE,
  PermissionLevel.DELETE,
  PermissionLevel.ADMIN,
];
