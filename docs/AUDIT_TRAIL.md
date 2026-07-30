# Audit Trail for Privileged Administrative Actions

StellarSwipe records privileged actions across two complementary audit trails.
Both capture **actor, target, timestamp, and reason** and are queryable through
a dedicated backend endpoint.

## 1. General application audit trail (`src/audit-log`)

Captures account-level admin actions: overrides (`AuditEventType.ADMIN_OVERRIDE`),
user creation/deletion, wallet changes, exports, API key lifecycle, login/logout.
Events are emitted via `EventEmitter2` (`audit.*`) and persisted by
`AuditEventListener` → `AuditService` into the `audit_logs` table
(`src/audit-log/entities/audit-log.entity.ts`), which stores `userId` (actor),
`resource`/`resourceId` (target), `createdAt` (timestamp), and `metadata`
(free-form context, including a reason where the caller supplies one).

**Query endpoints** (`src/audit-log/audit.controller.ts`):
- `GET /audit/logs` — filterable list (actor, action, date range, pagination).
- `GET /audit/:id` — single entry.
- `GET /audit/users/:userId` — full trail for one user.
- `GET /audit/resources/:resource/:resourceId` — full trail for one resource.
- `GET /audit/compliance/export/:userId` — compliance export.

## 2. RBAC / permission audit trail (`src/auth/permission-audit.service.ts`)

Captures role and permission changes and workflow approval decisions —
narrower and more structured than the general trail, with explicit
before/after diffs:

| Action | Emitted from |
|---|---|
| `ROLE_CREATED` / `ROLE_UPDATED` / `ROLE_DELETED` | `RbacService.createRole` / `updateRole` / `deleteRole` |
| `ROLE_ASSIGNED` / `ROLE_REVOKED` | `RbacService.assignRoleToUser` / `revokeRoleFromUser` |
| `PERMISSION_GRANTED` | `RbacService.assignPermissionsToRole` |
| `WORKFLOW_APPROVED` / `WORKFLOW_REJECTED` | `RbacService.approveRequest` / `rejectRequest` |

Each `PermissionAuditLog` row stores `actorId` (who acted), `targetUserId`
(whose access changed — for workflow decisions, the original requester),
`createdAt` (timestamp), `beforeState`/`afterState` (diff), and `metadata`
(includes the approver's `reason`/`comments` for workflow decisions).

**Query endpoint:** `GET /authorization/audit-log` (`RbacController.getPermissionAuditLog`,
requires `audit:read`), backed by `PermissionAuditService.query()`. Supports
`actorId`, `targetUserId`, `action`, `from`, `to`, `limit`, `offset` query params.

## Relationship to the permission matrix

Attempts to assign a role a permission that violates `PERMISSION_MATRIX`
(see `docs/PERMISSION_MATRIX.md`) are rejected with `400 Bad Request` before
any row is written — so the audit trail only ever contains grants that were
within policy at the time they were made.
