/**
 * Pure helpers backing the shared retry policy: error classification and
 * jittered exponential backoff. Kept dependency-free so they're trivial to
 * unit test in isolation from the NestJS DI container.
 */

export interface ClassifiableError {
  name?: string;
  code?: string;
  status?: number;
  statusCode?: number;
  response?: { status?: number; headers?: Record<string, string> };
}

/**
 * Determines whether an error represents a transient condition worth
 * retrying: connection timeouts, rate limiting (429), and 5xx server
 * errors. Client errors (4xx other than 429) and unrecognized errors are
 * treated as permanent failures — retrying them would just waste attempts
 * and duplicate side effects.
 */
export function isRetryableError(error: unknown): boolean {
  const err = (error ?? {}) as ClassifiableError;

  const timeoutCodes = new Set([
    'ETIMEDOUT',
    'ECONNABORTED',
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
  ]);
  if (err.code && timeoutCodes.has(err.code)) return true;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;

  const status = err.status ?? err.statusCode ?? err.response?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500 && status < 600) return true;

  return false;
}

/**
 * Extracts a server-provided retry delay (ms) from a `Retry-After` header,
 * if present. Supports both the delay-seconds form and an HTTP-date form.
 * Returns undefined when absent or unparsable, so the caller falls back to
 * its own computed backoff.
 */
export function extractRetryAfterMs(error: unknown): number | undefined {
  const err = (error ?? {}) as ClassifiableError;
  const header = err.response?.headers?.['retry-after'];
  if (!header) return undefined;

  const seconds = Number(header);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());

  return undefined;
}

/**
 * Computes the exponential backoff delay for a given (1-indexed) attempt
 * number, capped at `maxDelayMs`. When `jitter` is "full", applies AWS's
 * "full jitter" strategy — a uniformly random delay between 0 and the
 * capped exponential value — to avoid synchronized retry storms across
 * concurrent callers.
 */
export function computeBackoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitter: 'full' | 'none' = 'full',
): number {
  const exponential = baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const capped = Math.min(maxDelayMs, exponential);

  if (jitter === 'none') return capped;
  return Math.floor(Math.random() * capped);
}

/**
 * #1075 — Marker errors for background-job handlers.
 *
 * Throwing one of these bypasses pattern/status-based classification
 * entirely, letting a handler state its intent explicitly: `PermanentError`
 * short-circuits retries (e.g. "this payload will never validate"),
 * `RetryableError` forces a retry even if the message happens to match a
 * permanent-looking pattern.
 */
export class PermanentError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PermanentError';
  }
}

export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

/**
 * Message patterns that indicate a background job failed for a reason that
 * will not clear up on its own — bad input, missing resources, or an
 * authorization problem. Retrying these just delays the (identical) final
 * failure and wastes attempts/worker time.
 */
const PERMANENT_JOB_ERROR_PATTERNS = [
  /unauthorized/i,
  /forbidden/i,
  /not found/i,
  /validation failed/i,
  /invalid input/i,
];

/**
 * Classifies a background-job failure as permanent (should not be retried)
 * or retryable (transient, worth another attempt).
 *
 * This is deliberately the mirror image of `isRetryableError` above: that
 * helper is for outbound HTTP/integration calls and defaults to NOT
 * retrying anything it doesn't recognize (a false-positive retry there can
 * duplicate a side effect). Job handlers are different — most job failures
 * (a transient DB error, a downstream blip, an unhandled edge case) *are*
 * safe to retry, so an error thrown by a job handler is assumed retryable
 * unless it is explicitly marked `PermanentError` or matches a known
 * permanent-failure pattern (auth/validation/not-found) or a non-429 4xx
 * status. Callers that need the opposite default for a specific error can
 * throw `PermanentError`/`RetryableError` to override this heuristic.
 */
export function isPermanentJobError(error: unknown): boolean {
  if (error instanceof PermanentError) return true;
  if (error instanceof RetryableError) return false;

  const err = (error ?? {}) as ClassifiableError;
  const status = err.status ?? err.statusCode ?? err.response?.status;
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 429) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  return PERMANENT_JOB_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

/**
 * Whether an HTTP method is safe to retry automatically without an explicit
 * opt-in. POST and PATCH are excluded by default since a retried request
 * could duplicate a non-idempotent side effect.
 */
export function isIdempotentMethod(method: string | undefined): boolean {
  if (!method) return true; // unknown method: preserve prior behavior (retry), caller should pass method when known
  return IDEMPOTENT_METHODS.has(method.toUpperCase());
}
