import { registerAs } from '@nestjs/config';

/**
 * #issue4 — Centralized, per-integration retry policy configuration.
 *
 * Third-party integrations (currency providers, KYC vendors, webhook
 * delivery, etc.) previously handled transient failures inconsistently —
 * some retried inline with hardcoded delays, others not at all. This
 * config lets each integration have its own attempts/backoff/jitter
 * tuning without a code change, while sharing one retry implementation
 * (`RetryPolicyService`).
 *
 * Resolution order for a given integration name (e.g. "coinmarketcap"):
 *   1. `RETRY_<INTEGRATION>_*` env var (integration name upper-cased,
 *      non-alphanumeric chars replaced with `_`)
 *   2. `RETRY_DEFAULT_*` env var
 *   3. Hard-coded fallback below
 */
export interface RetryPolicyOptions {
  /** Maximum number of attempts, including the first (non-retry) call. */
  maxAttempts: number;
  /** Base delay (ms) for the first retry; doubles each subsequent attempt. */
  baseDelayMs: number;
  /** Upper bound (ms) on the computed backoff delay, before jitter. */
  maxDelayMs: number;
  /**
   * Jitter strategy: "full" picks a random delay in [0, backoff] (AWS
   * "full jitter"); "none" disables randomization (useful in tests).
   */
  jitter: 'full' | 'none';
}

const DEFAULTS: RetryPolicyOptions = {
  maxAttempts: 4,
  baseDelayMs: 200,
  maxDelayMs: 10_000,
  jitter: 'full',
};

function normalizeIntegrationName(integrationName: string): string {
  return integrationName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function readNumberEnv(...names: string[]): number | undefined {
  for (const name of names) {
    const raw = process.env[name];
    if (raw !== undefined && raw !== '') {
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return undefined;
}

function readJitterEnv(...names: string[]): 'full' | 'none' | undefined {
  for (const name of names) {
    const raw = process.env[name];
    if (raw === 'full' || raw === 'none') return raw;
  }
  return undefined;
}

/**
 * Resolves the effective retry policy for a named integration, merging
 * integration-specific env overrides over the shared defaults.
 */
export function resolveRetryPolicy(integrationName: string): RetryPolicyOptions {
  const key = normalizeIntegrationName(integrationName);

  return {
    maxAttempts:
      readNumberEnv(`RETRY_${key}_MAX_ATTEMPTS`, 'RETRY_DEFAULT_MAX_ATTEMPTS') ??
      DEFAULTS.maxAttempts,
    baseDelayMs:
      readNumberEnv(`RETRY_${key}_BASE_DELAY_MS`, 'RETRY_DEFAULT_BASE_DELAY_MS') ??
      DEFAULTS.baseDelayMs,
    maxDelayMs:
      readNumberEnv(`RETRY_${key}_MAX_DELAY_MS`, 'RETRY_DEFAULT_MAX_DELAY_MS') ??
      DEFAULTS.maxDelayMs,
    jitter:
      readJitterEnv(`RETRY_${key}_JITTER`, 'RETRY_DEFAULT_JITTER') ?? DEFAULTS.jitter,
  };
}

export const retryPolicyConfig = registerAs('retryPolicy', () => ({
  defaults: DEFAULTS,
}));
