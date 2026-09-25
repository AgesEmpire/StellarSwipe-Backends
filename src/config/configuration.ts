import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
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
