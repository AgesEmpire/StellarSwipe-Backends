/**
 * Canonical rate-limit response header names and a shared setter.
 *
 * Resolves: #1380 — rate-limit enforcement is spread across several
 * guards/middleware (RateLimitGuard, RateLimitMiddleware,
 * DistributedThrottlerGuard, ExternalIntegrationThrottlerGuard,
 * ApiKeyRateLimitService) that had each grown their own header vocabulary:
 * some used `X-RateLimit-*`, one used bare `RateLimit-*`, and one set no
 * rate-limit headers at all on a 429. Centralizing the names (and the
 * setter) here means every controller returns the same limit/remaining/
 * reset/retry-after headers regardless of which guard enforced the limit.
 */
export const RATE_LIMIT_HEADER_NAMES = {
  LIMIT: 'X-RateLimit-Limit',
  REMAINING: 'X-RateLimit-Remaining',
  RESET: 'X-RateLimit-Reset',
  RETRY_AFTER: 'Retry-After',
} as const;

export interface RateLimitHeaderValues {
  /** Effective limit for the window (post tier/override resolution). */
  limit?: number;
  /** Requests remaining in the current window. */
  remaining?: number;
  /** Window reset time (epoch ms), matching the guards' existing convention. */
  reset?: number;
  /** Seconds until the client may retry — only present once limit is exceeded. */
  retryAfter?: number;
}

type HeaderSettableResponse = { setHeader: (name: string, value: string | number) => unknown };

/**
 * Sets the standardized rate-limit headers on a response, skipping any
 * value that wasn't provided. Never throws — a missing/incompatible
 * response object (e.g. a transport that doesn't expose one) is a no-op,
 * so this is safe to call from guards that run across HTTP and GraphQL.
 *
 * Only effective limit/remaining/reset/retry-after timing is ever written
 * here — no internal policy details (tier names, store backend, bypass
 * secrets) are exposed to clients.
 */
export function setRateLimitHeaders(
  response: HeaderSettableResponse | undefined | null,
  values: RateLimitHeaderValues,
): void {
  if (!response?.setHeader) {
    return;
  }

  if (values.limit !== undefined) {
    response.setHeader(RATE_LIMIT_HEADER_NAMES.LIMIT, values.limit);
  }
  if (values.remaining !== undefined) {
    response.setHeader(RATE_LIMIT_HEADER_NAMES.REMAINING, values.remaining);
  }
  if (values.reset !== undefined) {
    response.setHeader(RATE_LIMIT_HEADER_NAMES.RESET, values.reset);
  }
  if (values.retryAfter !== undefined) {
    response.setHeader(RATE_LIMIT_HEADER_NAMES.RETRY_AFTER, values.retryAfter);
  }
}
