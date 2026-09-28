# API Reference — Test API v1.0

> Auto-generated on Mon, 27 Apr 2026 16:03:52 GMT

## Overview

Test

- **Total Endpoints:** 1
- **Authentication:** Bearer JWT
- **Base URL (Production):** `http://localhost:3000`

## Quick Links

- [Signals](#signals)

## Error Codes

| HTTP Status | Meaning |
|-------------|---------|
| `400` | Bad Request — Validation failed |
| `401` | Unauthorized — Missing or invalid token |
| `403` | Forbidden — Insufficient permissions |
| `404` | Not Found — Resource does not exist |
| `429` | Too Many Requests — Rate limit exceeded |
| `500` | Internal Server Error |

## Rate Limiting

Rate limit headers are returned on every response:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1700000000
```
