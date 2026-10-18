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
| `provider` | `string` | — | External provider name; runs each attempt inside that provider's concurrency limit |

## Per-Provider Concurrency Limits

Passing `provider` routes every attempt through `ProviderConcurrencyService`
(`src/http/provider-concurrency.service.ts`), which gives each external provider
its own bounded pool. A slow or failing provider can only use up its own slots,
so calls to unrelated providers stay available.

```typescript
await this.httpRetry.get(url, { params }, { provider: 'coingecko' });

// Non-HTTP SDK calls can be limited directly:
await this.providerConcurrency.execute('stellar-expert', () => sdk.call());
```

Limits are read per provider name (upper-cased, non-alphanumerics replaced with
`_`), falling back to the shared defaults. Values are validated at startup.

| Variable | Default | Description |
|---|---|---|
| `OUTBOUND_<PROVIDER>_MAX_CONCURRENT` | `OUTBOUND_DEFAULT_MAX_CONCURRENT` | Max in-flight requests to the provider (integer ≥ 1) |
| `OUTBOUND_<PROVIDER>_MAX_QUEUE` | `OUTBOUND_DEFAULT_MAX_QUEUE` | Max requests waiting for a free slot (integer ≥ 0) |
| `OUTBOUND_DEFAULT_MAX_CONCURRENT` | `10` | Default in-flight limit for any provider |
| `OUTBOUND_DEFAULT_MAX_QUEUE` | `50` | Default waiting-queue size for any provider |

### Saturation policy

1. While a slot is free, the request runs immediately.
2. Otherwise it waits in the provider's FIFO queue until a slot frees up.
3. When both the slots and the queue are full, the request fails fast with
   `BulkheadRejectedError` (the error names the provider). It is **not retried**,
   since a retry would only add load to a provider that is already saturated.
   Callers should treat it like the provider being unavailable (for example,
   fall back to another source or return 503).

A warning is logged on every rejection, and `ProviderConcurrencyService.getAllMetrics()`
reports active, queued and rejected counts per provider.

## Shared Retry Budgets (Issue #1376)

Per-call `maxAttempts` bounds how many times *one* request retries, but it does not
stop many independent callers from each retrying at the same time against a degraded
provider — that pile-up is a retry storm. `RetryBudgetService`
(`src/http/retry-budget.service.ts`) adds a shared token-bucket budget on top of
`maxAttempts`, keyed by `provider` (or `"default"` when no provider is set), so the
*rate* of retries against a given dependency is bounded across every caller sharing it:

```typescript
await this.httpRetry.get(url, { params }, { provider: 'coingecko' });
```

When the bucket for a key is empty, the next retry is skipped and the caller's
in-flight error is thrown immediately instead of being queued for another delayed
attempt — the same fail-fast behavior as a saturated provider bulkhead. Tokens refill
continuously (default: burst of 10, refilling at 2/sec), so normal transient-failure
retries are unaffected; only a sustained storm exhausts the budget.

`RetryBudgetService` is an optional dependency of `HttpRetryService` — omitting it
from a module's providers preserves the previous per-call-only retry behavior.

## Per-Provider Rate Limit (429) Handling (Issue #1374)

When a provider responds `429 Too Many Requests` with a `Retry-After` header (either
delay-seconds or an HTTP-date, per RFC 7231 §7.1.3), that hint is used for the next
retry's delay instead of the exponential backoff formula — the provider knows its own
rate-limit window better than we can guess. The honored delay is clamped to a
provider-specific cap so a misbehaving or malicious response can't force an
arbitrarily long wait:

| Variable | Default | Description |
|---|---|---|
| `OUTBOUND_<PROVIDER>_MAX_RETRY_AFTER_MS` | `OUTBOUND_DEFAULT_MAX_RETRY_AFTER_MS` | Max ms a `Retry-After` hint may push a retry out to |
| `OUTBOUND_DEFAULT_MAX_RETRY_AFTER_MS` | `30000` | Default cap for any provider |

A 429 without a usable `Retry-After` header, or any other retryable status, continues
to use the standard exponential backoff described above. Non-retryable responses
(permanent failures such as 400/401/403/404/422) are never retried regardless of any
rate-limit header present.

## Security Notes

- **401 / 403 are never retried** — retrying auth failures would mask misconfigured credentials and could trigger account lockouts on third-party APIs.
- **400 / 404 / 422 are never retried** — these indicate a client-side error that will not resolve on retry.
- The service does not modify request headers, tokens, or any auth material.
