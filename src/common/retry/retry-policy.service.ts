import { Injectable, Logger } from '@nestjs/common';
import { resolveRetryPolicy, RetryPolicyOptions } from './retry-policy.config';
import {
  computeBackoffDelayMs,
  extractRetryAfterMs,
  isIdempotentMethod,
  isRetryableError,
} from './retry.util';

export class RetryExhaustedError extends Error {
  constructor(
    public readonly integrationName: string,
    public readonly attempts: number,
    public readonly cause: unknown,
  ) {
    super(
      `Retry policy for "${integrationName}" exhausted after ${attempts} attempt(s): ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = 'RetryExhaustedError';
  }
}

/**
 * #issue4 — Shared retry policy for third-party integration calls.
 *
 * Centralizes exponential backoff + jitter so every integration handles
 * transient failures (timeouts, 429 rate limits, 5xx server errors) the
 * same way, instead of each client reimplementing its own ad-hoc retry
 * loop. Per-integration behavior stays configurable via
 * `resolveRetryPolicy()` / env vars (see retry-policy.config.ts) without
 * touching this class.
 *
 * Usage:
 *   await this.retryPolicyService.execute('coinmarketcap', () =>
 *     firstValueFrom(this.httpService.get(url)),
 *   );
 *
 * An optional `method` param tells the policy whether the call is
 * idempotent — non-idempotent methods (POST/PATCH) are not retried unless
 * `method` is omitted (preserving prior behavior for existing callers):
 *   await this.retryPolicyService.execute(
 *     'coinmarketcap',
 *     () => firstValueFrom(this.httpService.get(url)),
 *     {},
 *     'GET',
 *   );
 */
@Injectable()
export class RetryPolicyService {
  private readonly logger = new Logger(RetryPolicyService.name);

  /**
   * Runs `fn`, retrying on classified-transient failures according to the
   * named integration's policy. Non-retryable errors (e.g. 4xx client
   * errors) are rethrown immediately on the first failure. When all
   * attempts are exhausted, throws a `RetryExhaustedError` wrapping the
   * last observed error.
   */
  async execute<T>(
    integrationName: string,
    fn: () => Promise<T>,
    overrides: Partial<RetryPolicyOptions> = {},
    method?: string,
  ): Promise<T> {
    const policy = { ...resolveRetryPolicy(integrationName), ...overrides };
    let lastError: unknown;

    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (!isRetryableError(error) || !isIdempotentMethod(method)) {
          throw error;
        }

        if (attempt >= policy.maxAttempts) {
          break;
        }

        const retryAfterMs = extractRetryAfterMs(error);
        const delayMs =
          retryAfterMs ??
          computeBackoffDelayMs(attempt, policy.baseDelayMs, policy.maxDelayMs, policy.jitter);

        this.logger.warn(
          `[${integrationName}] attempt ${attempt}/${policy.maxAttempts} failed ` +
            `(${(error as Error)?.message ?? 'unknown error'}); retrying in ${delayMs}ms`,
        );

        await this.sleep(delayMs);
      }
    }

    throw new RetryExhaustedError(integrationName, policy.maxAttempts, lastError);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
