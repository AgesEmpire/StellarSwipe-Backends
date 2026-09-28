import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';

/**
 * Options controlling retry behaviour for a single request.
 */
export interface RetryOptions {
  /**
   * Maximum number of attempts (initial + retries).
   * Defaults to 3.
   */
  maxAttempts?: number;

  /**
   * Base delay in milliseconds for the first retry.
   * Each subsequent retry doubles this value (exponential backoff).
   * Defaults to 500 ms.
   */
  baseDelayMs?: number;

  /**
   * Maximum delay cap in milliseconds to prevent unbounded waits.
   * Defaults to 10 000 ms.
   */
  maxDelayMs?: number;

  /**
   * When true, adds a random jitter of up to 20 % of the computed delay
   * to spread thundering-herd retries across multiple instances.
   * Defaults to true.
   */
  jitter?: boolean;

  /**
   * HTTP status codes that are considered transient and should be retried.
   * Defaults to [429, 500, 502, 503, 504].
   */
  retryableStatuses?: number[];

  /**
   * Whether this operation is safe to retry automatically. Defaults to true
   * for idempotent HTTP methods (GET) and false for non-idempotent ones
   * (POST/PATCH) — pass `true` explicitly to opt a non-idempotent call into
   * retries when you've verified it's safe (e.g. the endpoint is designed
   * to be idempotent via an idempotency key).
   */
  idempotent?: boolean;
}

// `idempotent` is intentionally absent here: it has no universal default
// (retry-safety depends on the HTTP method), so it stays `undefined` unless
// a caller (or a method-specific convenience method like get()/post()) sets
// it explicitly. `undefined` is treated the same as "retryable" downstream,
// preserving behaviour for any caller that doesn't specify it.
const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'idempotent'>> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 10_000,
  jitter: true,
  retryableStatuses: [429, 500, 502, 503, 504],
};

/**
 * HttpRetryService
 *
 * A thin wrapper around NestJS HttpService that adds safe, configurable
 * exponential-backoff retry logic for transient third-party API failures.
 *
 * Features:
 *  - Exponential backoff:  delay = min(baseDelayMs * 2^(attempt-1), maxDelayMs)
 *  - Optional ±20 % jitter to avoid thundering-herd on multi-instance deploys
 *  - Configurable retryable HTTP status codes (defaults: 429, 5xx)
 *  - Network-level errors (ECONNRESET, ETIMEDOUT, etc.) are always retried
 *  - Non-retryable errors (4xx except 429) are thrown immediately
 *  - Structured log output on every retry attempt
 *
 * Usage:
 *   const data = await this.httpRetry.get('https://api.example.com/prices', {}, { maxAttempts: 4 });
 */
@Injectable()
export class HttpRetryService {
  private readonly logger = new Logger(HttpRetryService.name);

  constructor(private readonly httpService: HttpService) {}

  async get<T = any>(
    url: string,
    config?: AxiosRequestConfig,
    retryOptions?: RetryOptions,
  ): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(
      () => firstValueFrom(this.httpService.get<T>(url, config)),
      url,
      { idempotent: true, ...retryOptions },
    );
  }

  async post<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
    retryOptions?: RetryOptions,
  ): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(
      () => firstValueFrom(this.httpService.post<T>(url, data, config)),
      url,
      { idempotent: false, ...retryOptions },
    );
  }

  async put<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
    retryOptions?: RetryOptions,
  ): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(
      () => firstValueFrom(this.httpService.put<T>(url, data, config)),
      url,
      { idempotent: true, ...retryOptions },
    );
  }

  async patch<T = any>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
    retryOptions?: RetryOptions,
  ): Promise<AxiosResponse<T>> {
    return this.executeWithRetry(
      () => firstValueFrom(this.httpService.patch<T>(url, data, config)),
      url,
      { idempotent: false, ...retryOptions },
    );
  }

  // ---------------------------------------------------------------------------
  // Core retry engine
  // ---------------------------------------------------------------------------

  /**
   * Executes `fn` up to `maxAttempts` times, retrying on transient errors
   * with exponential backoff + optional jitter.
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    label = 'request',
    options?: RetryOptions,
  ): Promise<T> {
    const opts: Required<Omit<RetryOptions, 'idempotent'>> & Pick<RetryOptions, 'idempotent'> = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
    let lastError: Error;

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        const isLastAttempt = attempt === opts.maxAttempts;
        const isRetryable =
          opts.idempotent !== false && this.isRetryableError(error, opts.retryableStatuses);

        if (isLastAttempt || !isRetryable) {
          this.logger.error(
            `[HttpRetry] ${label} failed after ${attempt} attempt(s): ${error.message}`,
          );
          throw error;
        }

        const delay = this.computeDelay(attempt, opts);
        this.logger.warn(
          `[HttpRetry] ${label} attempt ${attempt}/${opts.maxAttempts} failed ` +
            `(${error.message}). Retrying in ${delay}ms…`,
        );
        await this.sleep(delay);
      }
    }

    // Unreachable, but satisfies TypeScript
    throw lastError!;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns true when the error is transient and safe to retry.
   * Network-level errors are always retried; HTTP errors are retried only
   * when their status code is in the retryableStatuses list.
   */
  isRetryableError(error: any, retryableStatuses: number[]): boolean {
    // Axios wraps HTTP errors in error.response
    if (error?.response?.status) {
      return retryableStatuses.includes(error.response.status);
    }
    // Network-level errors (no response): ECONNRESET, ETIMEDOUT, ENOTFOUND, etc.
    return true;
  }

  /**
   * Computes the delay for a given attempt using exponential backoff with
   * optional ±20 % jitter.
   *
   *   delay = min(baseDelayMs * 2^(attempt-1), maxDelayMs)
   *   if jitter: delay *= uniform(0.8, 1.2)
   */
  computeDelay(attempt: number, opts: Required<Omit<RetryOptions, 'idempotent'>>): number {
    const exponential = opts.baseDelayMs * Math.pow(2, attempt - 1);
    const capped = Math.min(exponential, opts.maxDelayMs);
    if (!opts.jitter) return capped;
    const jitterFactor = 0.8 + Math.random() * 0.4; // [0.8, 1.2)
    return Math.round(capped * jitterFactor);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
