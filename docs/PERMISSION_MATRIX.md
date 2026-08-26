# Permission Matrix

This document is the source of truth for what **admin**, **support**, and
**service account** roles are allowed to do. The machine-readable version
lives in `src/authorization/permission-matrix.ts` (`PERMISSION_MATRIX`) and
is enforced by `PermissionMatrixService`, which `RbacService` calls on every
role create/update and permission assignment — keep both in sync.

## Role Archetypes

| Archetype | `Role.name` | Who holds it |
|---|---|---|
| Admin | `admin` | Platform operators — full control over users, teams, content, billing, system config, trading, analytics, compliance. |
| Support | `support` | Customer support agents — can manage user accounts and content, but cannot touch billing, team/org structure, or system configuration. |
| Service account | `service_account` | Machine-to-machine callers (internal jobs, integrations) — scoped to trading and analytics pipelines only, no access to user PII or financial data. |

Only roles whose `name` matches one of the three values above (case-insensitive)
are constrained by the matrix. Custom/team roles created by `RbacService.createRole`
with any other name are unaffected — the matrix documents fixed archetypes, not
every ad-hoc role a team can define.

## Matrix

`PermissionLevel` values, from lowest to highest: `read` < `write` < `delete` < `admin`.
The table shows the **maximum** level each archetype may hold per category —
`—` means the archetype must hold no permission at all in that category.

| Category | Admin | Support | Service account |
|---|---|---|---|
| `user_management` | admin | write | — |
| `team_management` | admin | — | — |
| `content_management` | admin | write | — |
| `financial` | admin | — | — |
| `system` | admin | — | read |
| `trading` | admin | read | write |
| `analytics` | admin | read | write |
| `compliance` | admin | read | — |

## Enforcement

- **`PermissionMatrixService.findViolations(roleName, permissions)`** — compares a
  set of permissions against the ceiling for the role's resolved archetype and
  returns every permission that exceeds it.
- **`RbacService`** calls this in `createRole`, `updateRole`, and
  `assignPermissionsToRole` — attempting to grant `admin`, `support`, or
  `service_account` a permission above its ceiling throws a `400 Bad Request`
  before the assignment is persisted.
- Every role/permission mutation is already recorded by `PermissionAuditService`
  (see `src/audit-log`), so a rejected assignment shows up as a failed request
  in application logs, and an accepted one is queryable in the audit trail —
  see `docs/AUDIT_TRAIL.md`.

## Updating the Matrix

1. Edit `PERMISSION_MATRIX` in `src/authorization/permission-matrix.ts`.
2. Update the table above to match.
3. Existing role/permission assignments are **not** retroactively re-validated —
   only new writes are checked. Audit the current assignments for the affected
   archetype after tightening a ceiling.
