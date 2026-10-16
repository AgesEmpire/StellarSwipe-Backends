# GraphQL Field-Level Authorization Implementation

## Overview

This implementation adds field-level authorization for GraphQL using field extensions and a plugin-based approach.

## Implementation Details

### Components

**1. `src/graphQL-API/plugins/field-auth.plugin.ts`**
- Apollo Server plugin that intercepts field resolution
- Extracts authorization requirements from field extensions
- Checks user permissions/roles via PermissionChecker
- Returns null for unauthorized fields (following GraphQL conventions)

**2. `src/graphQL-API/plugins/field-auth.plugin.spec.ts`**
- Unit tests covering all authorization scenarios
- Tests role-based and permission-based access control
- Tests requireAll option for multiple permissions

### Key Features

**Uses Existing Permission System**
- Integrates with `PermissionChecker` from the authorization module
- No separate parallel system - uses the same roles/permissions
- Supports both permission names (`users:read`) and role names (`admin`)

**Per-Field Authorization**
- Add `extensions` to `@Field()` decorator to specify requirements
- Works on individual fields within an accessible type
- Does not affect other fields on the same type

**Graceful Unauthorized Handling**
- Returns null for unauthorized fields instead of failing query
- Follows GraphQL best practices
- Logs denied access attempts for audit purposes

### Usage Example

```ts
import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType()
export class UserType {
  @Field(() => ID)
  id: string;

  @Field()
  email: string;

  // This field requires 'admin' role
  @Field(() => String, {
    nullable: true,
    extensions: { authorization: { roles: ['admin'] } },
  })
  internalNotes?: string;

  // This field requires specific permission
  @Field(() => String, {
    nullable: true,
    extensions: { authorization: { permissions: ['users:read'] } },
  })
  sensitiveData?: string;

  // This field requires ALL of the specified permissions
  @Field(() => String, {
    nullable: true,
    extensions: { 
      authorization: { 
        permissions: ['users:read', 'users:admin'],
        requireAll: true 
      } 
    },
  })
  adminOnlyData?: string;
}
```

## Acceptance Criteria Verification

✅ **Field-level authorization decorator**: Use field `extensions` property to specify requirements
✅ **Uses existing role/permission system**: Integrates with `PermissionChecker` and existing guards
✅ **Returns null for unauthorized fields**: Plugin returns null instead of throwing errors
✅ **Unit tests covering scenarios**: Tests for role-based, permission-based, and requireAll cases

## Integration

The `FieldAuthorizationPlugin` is registered in `GraphqlModule`:
- Added to providers list
- Uses `@Plugin()` decorator for auto-registration
- Has access to `PermissionChecker` via DI

## Testing

Run tests with:
```bash
npm test -- src/graphQL-API/plugins/field-auth.plugin.spec.ts
```

## Query Complexity Limits by Role

In addition to field-level authorization, GraphQL execution is constrained by
configurable query complexity budgets that vary by the authenticated user's
role. This prevents expensive nested queries from consuming resolver work
before they are rejected.

### Components

**1. `src/graphQL-API/plugins/query-complexity.plugin.ts`**
- Apollo Server plugin that runs during `didResolveOperation`, i.e. after the
  document is parsed/validated but **before any resolver executes**
- Computes a static complexity score for the operation using the
  `graphql-query-complexity` estimator (default cost per field, multiplied by
  list/connection multipliers)
- Resolves the caller's role from the GraphQL context and looks up the matching
  budget
- Throws a `GraphQLError` with code `QUERY_TOO_COMPLEX` when the score exceeds
  the role's budget, so over-budget queries are rejected before resolver work

**2. `src/graphQL-API/plugins/query-complexity.plugin.spec.ts`**
- Unit tests for the estimator wiring and role resolution
- Representative nested queries (deeply nested selections, large list fields)
  asserted against each role's budget

### Role Budgets

Budgets are configurable via environment variables and fall back to safe
defaults. Each role gets its own ceiling:

| Role      | Env var                              | Default |
| --------- | ------------------------------------ | ------- |
| `admin`   | `GRAPHQL_MAX_COMPLEXITY_ADMIN`       | 10000   |
| `user`    | `GRAPHQL_MAX_COMPLEXITY_USER`        | 1000    |
| `guest`   | `GRAPHQL_MAX_COMPLEXITY_GUEST`       | 100    |
| anonymous | `GRAPHQL_MAX_COMPLEXITY_ANONYMOUS`   | 50      |

Unknown roles fall back to the anonymous budget so that a missing or
unrecognized role can never receive a larger budget than intended.

### Usage Example

```ts
// src/graphQL-API/graphql.module.ts
import { QueryComplexityPlugin } from './plugins/query-complexity.plugin';

@Module({
  providers: [QueryComplexityPlugin],
})
export class GraphqlModule {}
```

A query that exceeds the caller's budget is rejected with:

```json
{
  "errors": [
    {
      "message": "Query is too complex: 1523. Maximum allowed complexity for role 'user' is 1000.",
      "extensions": { "code": "QUERY_TOO_COMPLEX" }
    }
  ]
}
```

### Acceptance Criteria Verification

✅ **Configurable complexity budgets by role**: Budgets are read from env vars
with per-role defaults
✅ **Over-budget queries rejected before resolver work**: Enforcement runs in
`didResolveOperation`, prior to resolver execution
✅ **Role limits enforced**: The authenticated user's role selects the budget;
unknown roles fall back to the anonymous budget
✅ **Representative nested queries tested**: Spec covers nested selections and
list fields against each role's budget

## Future Enhancements

- Add directive-based approach for schema-first GraphQL
- Add support for resource-specific conditions
- Add caching for permission lookups
- Add per-operation complexity overrides for trusted internal clients
