import { registerAs } from '@nestjs/config';

/**
 * Redis cache configuration
 * TTL values for different data types:
 * - User sessions: 24 hours
 * - Signal feed: 30 seconds
 * - User portfolio: 5 minutes
 */
export const redisCacheConfig = registerAs('redisCache', () => ({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),

    // Connection pooling settings
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,

    // Every cache command is bounded independently of Redis reconnect retries.
    operationTimeoutMs: parseInt(process.env.REDIS_OPERATION_TIMEOUT_MS || '500', 10),
    recoveryAlertThreshold: parseInt(process.env.REDIS_RECOVERY_ALERT_THRESHOLD || '3', 10),

    // Cache reads fail open; session reads fail closed; rate limits fail open.
    policies: {
        cache: process.env.REDIS_CACHE_FAILURE_POLICY || 'fail-open',
        session: process.env.REDIS_SESSION_FAILURE_POLICY || 'fail-closed',
        rateLimit: process.env.REDIS_RATE_LIMIT_FAILURE_POLICY || 'fail-open',
    },

    // Key prefix for namespacing
    keyPrefix: 'stellarswipe:',

    // TTL values in seconds
    ttl: {
        session: 24 * 60 * 60,      // 24 hours
        signal: 30,                  // 30 seconds
        portfolio: 5 * 60,           // 5 minutes
        default: 60,                 // 1 minute default
    },
}));
