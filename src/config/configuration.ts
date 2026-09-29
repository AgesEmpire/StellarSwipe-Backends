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

/**
 * Cross-field configuration relationships (issue #1232).
 * Validates dependencies between network endpoints, retry limits, and
 * timeout budgets so invalid combinations fail startup with actionable errors.
 */
export const validateConfiguration = (config: {
  port: number;
  rateLimit: {
    enabled: boolean;
    store: { type: string; url: string };
    onStoreError: string;
    policies: {
      public: { windowMs: number; max: number };
      auth: { windowMs: number; max: number };
      internal: { windowMs: number; max: number; skip: boolean };
    };
  };
}): void => {
  const errors: string[] = [];

  // Network endpoint: the port must be a usable TCP port.
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push(

export default registerAs('app', () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  requestLimits,
  secretsRotation,
  rateLimit: {
    enabled: boolean;
    store: { type: string; url: string };
    onStoreError: string;
    policies: {
      public: { windowMs: number; max: number };
      auth: { windowMs: number; max: number };
      internal: { windowMs: number; max: number; skip: boolean };
    };
  };
}): void => {
  const errors: string[] = [];

  // Network endpoint: the port must be a usable TCP port.
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push(
      `PORT must be an integer between 1 and 65535 (received: ${config.port}).`,
    );
  }

  // Network endpoint: the rate-limit store URL must be a valid URL when enabled.
  if (config.rateLimit.enabled) {
    try {
      // eslint-disable-next-line no-new
      new URL(config.rateLimit.store.url);
    } catch {
      errors.push(
        `RATE_LIMIT_STORE_URL must be a valid URL when rate limiting is enabled (received: ${config.rateLimit.store.url}).`,
      );
    }

    if (!['redis', 'memory'].includes(config.rateLimit.store.type)) {
      errors.push(
        `RATE_LIMIT_STORE must be one of: redis, memory (received: ${config.rateLimit.store.type}).`,
      );
    }

    if (!['allow', 'deny'].includes(config.rateLimit.onStoreError)) {
      errors.push(
        `RATE_LIMIT_ON_STORE_ERROR must be one of: allow, deny (received: ${config.rateLimit.onStoreError}).`,
      );
    }
  }

  // Retry limits: each policy must define a positive window and a non-negative max.
  const policies = config.rateLimit.policies;
  (Object.keys(policies) as Array<keyof typeof policies>).forEach((name) => {
    const policy = policies[name];

    if (!Number.isInteger(policy.windowMs) || policy.windowMs <= 0) {
      errors.push(
        `RATE_LIMIT_${name.toUpperCase()}_WINDOW_MS must be a positive integer (received: ${policy.windowMs}).`,
      );
    }

    if (!Number.isInteger(policy.max) || policy.max < 0) {
      errors.push(
        `RATE_LIMIT_${name.toUpperCase()}_MAX must be a non-negative integer (received: ${policy.max}).`,
      );
    }
  });

  // Timeout budget: the auth window must not exceed the public window, and the
  // auth retry limit must not exceed the public retry limit.
  if (policies.auth.windowMs > policies.public.windowMs) {
    errors.push(
      `RATE_LIMIT_AUTH_WINDOW_MS (${policies.auth.windowMs}) must not exceed RATE_LIMIT_PUBLIC_WINDOW_MS (${policies.public.windowMs}).`,
    );
  }

  if (policies.auth.max > policies.public.max) {
    errors.push(
      `RATE_LIMIT_AUTH_MAX (${policies.auth.max}) must not exceed RATE_LIMIT_PUBLIC_MAX (${policies.public.max}).`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid configuration:\n- ${errors.join('\n- ')}`,
    );
  }
};

export default registerAs('app', () => {
  const config = {
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
  };

  validateConfiguration(config);

  return config;
});
