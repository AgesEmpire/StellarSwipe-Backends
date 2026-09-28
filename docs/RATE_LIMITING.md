# Rate Limiting & Abuse Protection

## Overview

`RateLimitGuard` (`src/common/guards/rate-limit.guard.ts`) protects public and authenticated
API routes from abuse using a Redis-backed (via `cache-manager`), tier-based sliding window
counter. It is registered globally as an `APP_GUARD` in `RateLimitModule`, so every route is
covered by a sensible default even without an explicit decorator — individual endpoints
opt into a specific tier and/or custom limit with the `@RateLimit()` decorator.

Authentication (`/auth/*`), payment (`/payments/*`), and trading (`/trades/*`) routes —
the highest-value targets for credential stuffing, payment fraud, and order-flooding — have
explicit per-route limits in addition to the global default.

## Tiers

| Tier | Identifier | Default limit | Default window | Typical use |
|------|-----------|----------------|-----------------|-------------|
| `PUBLIC` | client IP | 100 | 15 min | Unauthenticated endpoints (login, registration, webhooks) |
| `AUTHENTICATED` | user ID (falls back to IP) | 1000 | 15 min | Default tier for any authenticated route without an explicit decorator |
| `TRADE` | user ID (falls back to IP) | 10 | 60 sec | Trade execution / order placement endpoints |
| `SIGNAL` | user ID (falls back to IP) | 10 | 24 hr | Signal-provider submission endpoints |
| `ADMIN` | user ID | 10000 | 15 min | Admin/back-office tooling |

## Configuring limits

Each tier's limit and window can be overridden via environment variables without a code
change, falling back to the defaults above when unset:

```
RATE_LIMIT_PUBLIC_LIMIT=100
RATE_LIMIT_PUBLIC_WINDOW=900        # seconds
RATE_LIMIT_AUTHENTICATED_LIMIT=1000
RATE_LIMIT_AUTHENTICATED_WINDOW=900
RATE_LIMIT_TRADE_LIMIT=10
RATE_LIMIT_TRADE_WINDOW=60
RATE_LIMIT_SIGNAL_LIMIT=10
RATE_LIMIT_SIGNAL_WINDOW=86400
RATE_LIMIT_ADMIN_LIMIT=10000
RATE_LIMIT_ADMIN_WINDOW=900
```

Individual endpoints can further tighten (but not bypass) their tier via the decorator:

```typescript
@Post('forgot-password')
@RateLimit({ tier: RateLimitTier.PUBLIC, limit: 5, window: 60 })
async forgotPassword(@Body() dto: ForgotPasswordDto) { ... }
```

A per-endpoint `limit`/`window` always takes precedence over the tier's configured default.

## Response headers

Every rate-limited response — successful or not — includes:

| Header | Meaning |
|--------|---------|
| `X-RateLimit-Limit` | Max requests allowed in the current window |
| `X-RateLimit-Remaining` | Requests left before the limit resets |
| `X-RateLimit-Reset` | Unix timestamp (ms) when the window resets |

## 429 Too Many Requests

When the limit is exceeded, the guard throws `HttpException` with status `429` and:

- A `Retry-After` header (seconds until the window resets)
- A JSON body with `statusCode`, `message`, `retryAfter`, and a human-readable `guidance`
  string explaining exactly when to retry, e.g.:

```json
{
  "statusCode": 429,
  "message": "Too many requests",
  "error": "Too Many Requests",
  "retryAfter": 42,
  "guidance": "Rate limit of 10 requests per 60s exceeded. Retry after 42s or once the X-RateLimit-Reset timestamp has passed."
}
```

Clients should treat `429` as transient and retry using either the `Retry-After` header or
the documented backoff policy in [`HTTP_RETRY.md`](./HTTP_RETRY.md).

## Adding rate limiting to a new route

```typescript
import { RateLimit, RateLimitTier } from '../common/decorators/rate-limit.decorator';

@Post('execute')
@RateLimit({ tier: RateLimitTier.TRADE })
async executeTrade(@Body() dto: ExecuteTradeDto) { ... }
```

Omit `limit`/`window` to use the tier's configured default, or supply both to override per
route (e.g. tighter limits on payment-initiation endpoints than on read-only ones).

## Testing

`src/common/guards/rate-limit.guard.spec.ts` covers normal traffic, exceeded traffic, header
behavior, per-tier identifier selection (user ID vs IP), and env-var-driven limit overrides.
