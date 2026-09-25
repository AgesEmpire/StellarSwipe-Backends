import { registerAs } from '@nestjs/config';

import { registerAs } from '@nestjs/config';

/**
 * Parse a positive integer from an environment variable.
 * Returns the fallback when the value is missing or not a valid positive integer.
 */
const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

/**
 * Request payload and parameter size limits (issue #1166).
 * All limits are configurable via environment variables and enforced
 * consistently across transports before expensive processing occurs.
 */
const requestLimits = {
  jsonBody: parsePositiveInt(process.env.REQUEST_LIMIT_JSON_BODY, 1 * 1024 * 1024),
  multipartUpload: parsePositiveInt(process.env.REQUEST_LIMIT_MULTIPART_UPLOAD, 10 * 1024 * 1024),
  queryString: parsePositiveInt(process.env.REQUEST_LIMIT_QUERY_STRING, 2 * 1024),
  headers: parsePositiveInt(process.env.REQUEST_LIMIT_HEADERS, 8 * 1024),
  routeParameter: parsePositiveInt(process.env.REQUEST_LIMIT_ROUTE_PARAMETER, 256),
};

export default registerAs('app', () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  requestLimits,
  rateLimit: {
    // Distributed rate limiting for public and auth-sensitive routes.
    // Uses a shared store (Redis) so limits are enforced across all instances.
    enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    store: {
      type: process.env.RATE_LIMIT_STORE || 'redis',
      url: process.env.RATE_LIMIT_STORE_URL || process.env.REDIS_URL || 'redis://localhost:6379',
      keyPrefix: process.env.RATE_LIMIT_KEY_PREFIX || 'ratelimit:',
    },
    // Behavior when the shared store is unavailable.
    // 'allow' fails open (availability over strictness), 'deny' fails closed.
    onStoreError: process.env.RATE_LIMIT_ON_STORE_ERROR || 'allow',
    policies: {
      // Public, unauthenticated routes.
      public: {
        windowMs: parseInt(process.env.RATE_LIMIT_PUBLIC_WINDOW_MS || '60000', 10),
        max: parseInt(process.env.RATE_LIMIT_PUBLIC_MAX || '100', 10),
      },
      // Authentication-sensitive routes (login, token, password reset).
      auth: {
        windowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || '60000', 10),
        max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '10', 10),
      },
      // Trusted internal routes: explicit, effectively unlimited policy.
      internal: {
        windowMs: parseInt(process.env.RATE_LIMIT_INTERNAL_WINDOW_MS || '60000', 10),
        max: parseInt(process.env.RATE_LIMIT_INTERNAL_MAX || '0', 10),
        skip: true,
      },
    },
    // Standard rate-limit metadata headers returned to clients.
    headers: {
      limit: 'RateLimit-Limit',
      remaining: 'RateLimit-Remaining',
      reset: 'RateLimit-Reset',
      retryAfter: 'Retry-After',
    },
  },
}));
