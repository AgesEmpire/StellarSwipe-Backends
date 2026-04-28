# API Versioning Guide

## Overview

StellarSwipe API uses **URI-based versioning** as the primary strategy, with optional header-based fallback. NestJS `VersioningType.URI` is enabled globally in `main.ts`.

## Version Detection

### URI-based (Recommended)
```
GET /api/v1/signals
GET /api/v2/signals
```

### Header-based (fallback)
```
GET /api/signals
api-version: 2
```

When both are present, the URI version takes precedence.

## Current Versions

| Version | Status     | Sunset Date | Notes                        |
|---------|------------|-------------|------------------------------|
| v1      | Deprecated | 2025-12-31  | Migrate to v2                |
| v2      | Supported  | —           | Current stable version       |

## Deprecation Notices

### Version-level (automatic)

`VersionResolverMiddleware` runs on every request. When a deprecated version is detected it automatically injects:

```
Deprecation: true
Sunset: 2025-12-31
Link: </api/v2>; rel="successor-version"
```

### Endpoint-level (opt-in)

Use the `@Deprecated()` decorator on any controller or handler. The global `DeprecationInterceptor` reads this metadata and sets the same headers plus a human-readable notice:

```typescript
import { Deprecated } from '../versioning/decorators/deprecated.decorator';

@Get('old-endpoint')
@Deprecated({ sunsetDate: '2025-12-31', successorVersion: '2', reason: 'Use /new-endpoint instead.' })
async oldEndpoint() { ... }
```

Response headers emitted:
```
Deprecation: true
Sunset: 2025-12-31
Link: </api/v2>; rel="successor-version"
X-Deprecation-Notice: This endpoint is deprecated. Use /new-endpoint instead. Sunset date: 2025-12-31. Please migrate to v2.
```

## Architecture

| Component                        | Location                                              | Role                                                    |
|----------------------------------|-------------------------------------------------------|---------------------------------------------------------|
| `VersioningType.URI`             | `src/main.ts`                                         | Enables NestJS URI versioning globally                  |
| `VersionResolverMiddleware`      | `src/versioning/middleware/`                          | Resolves version, rejects unsupported, sets headers     |
| `DeprecationInterceptor`         | `src/versioning/interceptors/`                        | Reads `@Deprecated()` metadata, sets response headers   |
| `VersionManagerService`          | `src/versioning/version-manager.service.ts`           | Version registry and status queries                     |
| `@Deprecated()` decorator        | `src/versioning/decorators/deprecated.decorator.ts`   | Marks individual endpoints as deprecated                |
| `@ApiVersion()` decorator        | `src/versioning/decorators/api-version.decorator.ts`  | Tags controllers/handlers with a version string         |

## Adding a New Version

1. Add the version entry to `VersionManagerService.config.versions`:
   ```typescript
   '3': { status: VersionStatus.SUPPORTED, description: 'Next generation API.' }
   ```
2. Update the predecessor entry with `successorVersion: '3'`.
3. Update this document.

## Migration Guide

### v1 → v2
- Replace `/api/v1/` with `/api/v2/` in all request URLs.
- Review response schema changes for affected endpoints.
- Complete migration before **2025-12-31** (v1 sunset date).

## Best Practices
- Always specify the version explicitly in the URL.
- Monitor `Deprecation` and `Sunset` response headers in your client.
- Plan migrations well before sunset dates.
- Use the latest stable version for all new integrations.
