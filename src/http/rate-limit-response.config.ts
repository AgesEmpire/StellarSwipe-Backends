/**
 * #1374 — Per-provider outbound rate-limit (HTTP 429) response handling.
 *
 * When an external provider responds with 429 Too Many Requests, it often
 * tells us exactly how long to wait via the standard `Retry-After` header
 * (either a number of seconds, or an HTTP-date). We should honour that hint
 * rather than our own exponential backoff guess — but an untrusted or
 * misbehaving provider could also send an absurdly large value, so each
 * provider gets a configured cap on how long we'll ever defer a single
 * retry because of it.
 *
 * Resolution order for a given provider name (e.g. "coingecko"), mirroring
 * `provider-concurrency.config.ts`:
 *   1. `OUTBOUND_<PROVIDER>_MAX_RETRY_AFTER_MS`
 *   2. `OUTBOUND_DEFAULT_MAX_RETRY_AFTER_MS`
 *   3. Hard-coded fallback below
 */
const DEFAULT_MAX_RETRY_AFTER_MS = 30_000;

function normalizeProviderName(provider: string): string {
  return provider.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function readCap(names: string[]): number | undefined {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be an integer >= 0 (got "${raw}")`);
    }
    return value;
  }
  return undefined;
}

/**
 * Resolves the maximum number of milliseconds a provider's `Retry-After`
 * hint is allowed to push a single retry out to. Values above this cap are
 * clamped, never discarded outright, so the retry still happens — just not
 * later than the configured ceiling.
 */
export function resolveMaxRetryAfterMs(provider: string): number {
  const key = normalizeProviderName(provider);
  return (
    readCap([
      `OUTBOUND_${key}_MAX_RETRY_AFTER_MS`,
      'OUTBOUND_DEFAULT_MAX_RETRY_AFTER_MS',
    ]) ?? DEFAULT_MAX_RETRY_AFTER_MS
  );
}

/**
 * Parses a `Retry-After` header value into milliseconds. Supports both the
 * delay-seconds form (`Retry-After: 120`) and the HTTP-date form
 * (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`), per RFC 7231 §7.1.3.
 * Returns `undefined` when the header is missing or unparsable.
 */
export function parseRetryAfterMs(
  value: string | string[] | undefined | null,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === '') return undefined;

  const seconds = Number(raw);
  if (!Number.isNaN(seconds) && Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return undefined;
}
