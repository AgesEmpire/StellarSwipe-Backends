/**
 * Bounded retry policy for transient database failures.
 *
 * Retries are bounded and configurable, use exponential backoff with jitter,
 * and only apply to transient errors. Constraint, validation, and other
 * non-retryable failures are surfaced immediately.
 */

export interface RetryPolicyOptions {
  /** Maximum number of attempts, including the initial one. */
  maxAttempts?: number;
  /** Base delay in milliseconds for the first backoff. */
  baseDelayMs?: number;
  /** Upper bound for any single backoff delay in milliseconds. */
  maxDelayMs?: number;
  /** Jitter ratio (0..1) applied to each computed delay. */
  jitterRatio?: number;
  /** Predicate deciding whether an error is transient and retryable. */
  isRetryable?: (error: unknown) => boolean;
  /** Optional hook invoked before each retry attempt. */
  onRetry?: (info: RetryAttemptInfo) => void;
  /** Optional hook invoked when all attempts are exhausted. */
  onFinalFailure?: (info: RetryFinalFailureInfo) => void;
  /** Injectable sleep, primarily for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable random source in [0, 1), primarily for tests. */
  random?: () => number;
}

export interface RetryAttemptInfo {
  /** 1-based attempt number that just failed. */
  attempt: number;
  /** Total attempts allowed. */
  maxAttempts: number;
  /** Delay in milliseconds before the next attempt. */
  delayMs: number;
  /** The error that triggered the retry. */
  error: unknown;
}

export interface RetryFinalFailureInfo {
  /** Total attempts made. */
  attempts: number;
  /** The last error observed. */
  error: unknown;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 50;
const DEFAULT_MAX_DELAY_MS = 2_000;
const DEFAULT_JITTER_RATIO = 0.2;

/**
 * Error codes that are never retried: constraint, validation, and other
 * deterministic failures that will not succeed on a subsequent attempt.
 */
const NON_RETRYABLE_CODES = new Set<string>([
  '23505', // unique_violation
  '23503', // foreign_key_violation
  '23502', // not_null_violation
  '23514', // check_violation
  '23P01', // exclusion_violation
  '22P02', // invalid_text_representation
  '22001', // string_data_right_truncation
  '22003', // numeric_value_out_of_range
  '40001', // serialization_failure is retryable, handled below
]);

/**
 * Error codes that are safe to retry: transient connection and concurrency
 * failures.
 */
const RETRYABLE_CODES = new Set<string>([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
]);

const RETRYABLE_MESSAGE_PATTERNS: RegExp[] = [
  /deadlock/i,
  /serialization failure/i,
  /could not serialize/i,
  /connection (?:terminated|reset|refused|closed)/i,
  /econnreset/i,
  /etimedout/i,
  /econnrefused/i,
  /socket hang up/i,
  /too many connections/i,
  /server closed the connection/i,
];

const NON_RETRYABLE_MESSAGE_PATTERNS: RegExp[] = [
  /constraint/i,
  /unique violation/i,
  /foreign key/i,
  /not[- ]null/i,
  /check violation/i,
  /validation/i,
  /invalid input/i,
  /syntax error/i,
];

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const candidate = error as { code?: unknown; errno?: unknown };
  if (typeof candidate.code === 'string') {
    return candidate.code;
  }
  if (typeof candidate.code === 'number') {
    return String(candidate.code);
  }
  if (typeof candidate.errno === 'string') {
    return candidate.errno;
  }
  return undefined;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '';
}

/**
 * Default classifier: retries only transient database failures and rejects
 * constraint, validation, and other non-retryable errors.
 */
export function isTransientDatabaseError(error: unknown): boolean {
  const code = readErrorCode(error);
  if (code !== undefined) {
    if (NON_RETRYABLE_CODES.has(code)) {
      return false;
    }
    if (RETRYABLE_CODES.has(code)) {
      return true;
    }
  }

  const message = readErrorMessage(error);
  if (message.length > 0) {
    if (NON_RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
      return false;
    }
    if (RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
      return true;
    }
  }

  return false;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Computes the backoff delay for a given attempt using exponential growth,
 * capped at maxDelayMs, with symmetric jitter applied.
 */
export function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterRatio: number,
  random: () => number,
): number {
  const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(exponential, maxDelayMs);
  if (jitterRatio <= 0) {
    return Math.round(capped);
  }
  const jitterSpan = capped * jitterRatio;
  const jitter = (random() * 2 - 1) * jitterSpan;
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * Executes `operation` under a bounded retry policy. Only errors classified as
 * transient are retried; all other errors are rethrown immediately.
 */
export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  options: RetryPolicyOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const jitterRatio = Math.min(1, Math.max(0, options.jitterRatio ?? DEFAULT_JITTER_RATIO));
  const isRetryable = options.isRetryable ?? isTransientDatabaseError;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      const retryable = isRetryable(error);
      const exhausted = attempt >= maxAttempts;

      if (!retryable || exhausted) {
        options.onFinalFailure?.({ attempts: attempt, error });
        throw error;
      }

      const delayMs = computeBackoffDelay(attempt, baseDelayMs, maxDelayMs, jitterRatio, random);
      options.onRetry?.({ attempt, maxAttempts, delayMs, error });
      await sleep(delayMs);
    }
  }
}
