/**
 * #1235 — Per-provider outbound request concurrency limits.
 *
 * Every external provider (price feeds, KYC vendors, webhooks, …) gets its own
 * bounded pool so a slow or failing provider can only exhaust its own slots
 * and never starve calls to unrelated providers.
 *
 * Resolution order for a given provider name (e.g. "coingecko"):
 *   1. `OUTBOUND_<PROVIDER>_MAX_CONCURRENT` / `OUTBOUND_<PROVIDER>_MAX_QUEUE`
 *      (provider name upper-cased, non-alphanumeric chars replaced with `_`)
 *   2. `OUTBOUND_DEFAULT_MAX_CONCURRENT` / `OUTBOUND_DEFAULT_MAX_QUEUE`
 *   3. Hard-coded fallback below
 */
export interface ProviderConcurrencyLimits {
  /** Maximum number of in-flight requests to the provider. */
  maxConcurrent: number;
  /** Maximum number of requests allowed to wait for a free slot. */
  maxQueue: number;
}

export const DEFAULT_PROVIDER_CONCURRENCY: ProviderConcurrencyLimits = {
  maxConcurrent: 10,
  maxQueue: 50,
};

function normalizeProviderName(provider: string): string {
  return provider.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function readLimit(min: number, names: string[]): number | undefined {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min) {
      throw new Error(`${name} must be an integer >= ${min} (got "${raw}")`);
    }
    return value;
  }
  return undefined;
}

/**
 * Resolves the effective concurrency limits for a named provider, merging
 * provider-specific env overrides over the shared defaults. Throws when a
 * configured value is not a valid limit.
 */
export function resolveProviderConcurrency(
  provider: string,
): ProviderConcurrencyLimits {
  const key = normalizeProviderName(provider);
  return {
    maxConcurrent:
      readLimit(1, [
        `OUTBOUND_${key}_MAX_CONCURRENT`,
        'OUTBOUND_DEFAULT_MAX_CONCURRENT',
      ]) ?? DEFAULT_PROVIDER_CONCURRENCY.maxConcurrent,
    maxQueue:
      readLimit(0, [
        `OUTBOUND_${key}_MAX_QUEUE`,
        'OUTBOUND_DEFAULT_MAX_QUEUE',
      ]) ?? DEFAULT_PROVIDER_CONCURRENCY.maxQueue,
  };
}
