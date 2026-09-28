# HTTP Retry — Transient API Call Resilience

## Overview

`HttpRetryService` (`src/http/http-retry.service.ts`) is the single, centralised place for making outbound HTTP calls to third-party APIs with safe exponential-backoff retry logic.

It wraps NestJS `HttpService` (Axios) and adds:

- Exponential backoff with configurable base delay and cap
- Optional ±20 % jitter to prevent thundering-herd retries across instances
- Configurable retryable HTTP status codes (defaults: 429, 500, 502, 503, 504)
- Immediate throw for non-transient errors (4xx except 429) — auth/authz semantics are preserved
- Network-level errors (ECONNRESET, ETIMEDOUT, etc.) are always retried
- Structured log output on every retry attempt and final failure

## Delay Formula

```
delay = min(baseDelayMs × 2^(attempt−1), maxDelayMs)
if jitter: delay × uniform(0.8, 1.2)
```

| Attempt | baseDelayMs=500, no jitter |
|---------|---------------------------|
| 1 (retry) | 500 ms |
| 2 (retry) | 1 000 ms |
| 3 (retry) | 2 000 ms |
| … | capped at maxDelayMs |

## Usage

### 1. Import the module

```typescript
import { HttpRetryModule } from '../http/http.module';

@Module({ imports: [HttpRetryModule] })
export class PricesModule {}
```

### 2. Inject and call

```typescript
import { HttpRetryService } from '../http/http-retry.service';

@Injectable()
export class CoinGeckoPriceProvider {
  constructor(private readonly httpRetry: HttpRetryService) {}

  async getPrice(pair: string) {
    const { data } = await this.httpRetry.get(
      `https://api.coingecko.com/api/v3/simple/price`,
      { params: { ids: pair } },
      { maxAttempts: 4, baseDelayMs: 300 },
    );
    return data;
  }
}
```

### 3. Generic wrapper for non-HTTP async calls

```typescript
const result = await this.httpRetry.executeWithRetry(
  () => someThirdPartySDK.call(),
  'stellar-horizon',
  { maxAttempts: 3 },
);
```

## Configuration Options

| Option | Type | Default | Description |
|---|---|---|---|
| `maxAttempts` | `number` | `3` | Total attempts (1 initial + N-1 retries) |
| `baseDelayMs` | `number` | `500` | Delay before first retry (ms) |
| `maxDelayMs` | `number` | `10000` | Upper cap on computed delay (ms) |
| `jitter` | `boolean` | `true` | Add ±20 % random jitter |
| `retryableStatuses` | `number[]` | `[429,500,502,503,504]` | HTTP codes to retry |

## Security Notes

- **401 / 403 are never retried** — retrying auth failures would mask misconfigured credentials and could trigger account lockouts on third-party APIs.
- **400 / 404 / 422 are never retried** — these indicate a client-side error that will not resolve on retry.
- The service does not modify request headers, tokens, or any auth material.
