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

/**
 * Runtime credential rotation (issue #1165).
 *
 * Credentials are refreshed at runtime without restarting the process. The
 * rotation is atomic: new operations immediately observe the replacement
 * credential, while in-flight operations may continue using the previous
 * credential for a bounded overlap window before it is discarded.
 *
 * Only non-sensitive metadata is exposed for observability; secret values are
 * never logged or emitted in telemetry.
 */
const secretsRotation = {
  // Master switch for runtime credential refresh.
  enabled: process.env.SECRETS_ROTATION_ENABLED !== 'false',
  // How long the previous credential remains valid for in-flight work after a
  // successful rotation, in milliseconds. Bounded to avoid unbounded overlap.
  overlapMs: parsePositiveInt(process.env.SECRETS_ROTATION_OVERLAP_MS, 30_000),
  // Maximum time to wait for in-flight operations to drain before the previous
  // credential is force-discarded, in milliseconds.
  drainTimeoutMs: parsePositiveInt(process.env.SECRETS_ROTATION_DRAIN_TIMEOUT_MS, 60_000),
  // Interval between automatic rotation checks, in milliseconds. Set to 0 to
  // disable automatic rotation and rely on explicit/manual rotation only.
  checkIntervalMs: parsePositiveInt(process.env.SECRETS_ROTATION_CHECK_INTERVAL_MS, 60_000),
  // Names of the credentials managed by the runtime store. Only names are
  // configured here; values are resolved from the environment at rotation time
  // and never persisted in configuration output.
  managed: (process.env.SECRETS_ROTATION_MANAGED || '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0),
};

export default registerAs('app', () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  requestLimits,
  secretsRotation,
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
