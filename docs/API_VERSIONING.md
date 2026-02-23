# API Versioning Guide

## Overview
StellarSwipe API supports multiple versions to ensure backward compatibility during updates.

## Version Detection

### URL-based (Recommended)
```
GET /api/v1/signals
GET /api/v2/signals
```

### Header-based
```
GET /api/signals
Headers: { "api-version": "2" }
```

## Current Versions

### v1 (Deprecated)
- **Status**: Deprecated
- **Sunset Date**: 2025-12-31
- **Features**: Original API implementation

### v2 (Current)
- **Status**: Active
- **Features**: Enhanced response formats, improved error handling

## Deprecation Warnings

Deprecated versions return these headers:
```
Deprecation: true
Sunset: 2025-12-31
Link: </api/v2>; rel="successor-version"
```

## Migration Guide

### v1 to v2
- Update base URL from `/api/v1` to `/api/v2`
- Review response schema changes in affected endpoints
- Test thoroughly before sunset date

## Best Practices
- Always specify version explicitly
- Monitor deprecation headers
- Plan migrations before sunset dates
- Use latest stable version for new integrations
