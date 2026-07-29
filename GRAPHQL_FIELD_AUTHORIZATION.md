# GraphQL Field-Level Authorization Implementation

## Overview

This implementation adds field-level authorization for GraphQL using field extensions and a plugin-based approach.

## Implementation Details

### Components

**1. `src/graphQL-API/plugins/field-auth.plugin.ts`**
- Apollo Server plugin that intercepts field resolution
- Extracts authorization requirements from field extensions
- Checks user permissions/roles via PermissionChecker
- Returns null for unauthorized fields (per GraphQL conventions)

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

## Future Enhancements

- Add directive-based approach for schema-first GraphQL
- Add support for resource-specific conditions
- Add caching for permission lookups