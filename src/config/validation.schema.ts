import * as Joi from 'joi';

/**
 * Cross-field configuration validation.
 *
 * Validates relationships between configuration values (network endpoints,
 * retry limits and timeout budgets) so that invalid combinations fail
 * application startup with actionable error messages.
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  PORT: Joi.number().port().default(3000),

  // Network endpoints
  REDIS_HOST: Joi.string().hostname().required(),
  REDIS_PORT: Joi.number().port().required(),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).optional(),

  // Retry limits
  QUEUE_MAX_RETRIES: Joi.number().integer().min(0).max(100).default(3),
  QUEUE_RETRY_DELAY_MS: Joi.number().integer().min(0).default(1000),

  // Timeout budgets
  QUEUE_JOB_TIMEOUT_MS: Joi.number().integer().min(1).default(30000),
  QUEUE_SHUTDOWN_GRACE_MS: Joi.number().integer().min(0).default(10000),
})
  .custom((value, helpers) => {
    // Network endpoint relationship: when REDIS_URL is provided it must be
    // consistent with the discrete host/port pair.
    if (value.REDIS_URL) {
      let parsed: URL;
      try {
        parsed = new URL(value.REDIS_URL);
      } catch {
        return helpers.error('any.invalid', {
          message: 'REDIS_URL must be a valid redis:// or rediss:// URL',
        });
      }

      const urlPort = parsed.port ? Number(parsed.port) : 6379;
      if (parsed.hostname !== value.REDIS_HOST || urlPort !== value.REDIS_PORT) {
        return helpers.error('any.invalid', {
          message:
            'REDIS_URL must match REDIS_HOST and REDIS_PORT ' +
            `(got ${parsed.hostname}:${urlPort}, expected ${value.REDIS_HOST}:${value.REDIS_PORT})`,
        });
      }
    }

    // Retry limit relationship: a retry delay is meaningless without retries.
    if (value.QUEUE_MAX_RETRIES === 0 && value.QUEUE_RETRY_DELAY_MS > 0) {
      return helpers.error('any.invalid', {
        message:
          'QUEUE_RETRY_DELAY_MS must be 0 when QUEUE_MAX_RETRIES is 0',
      });
    }

    // Timeout budget relationship: the shutdown grace period must not exceed
    // the per-job timeout budget, otherwise in-flight jobs can never drain.
    if (value.QUEUE_SHUTDOWN_GRACE_MS > value.QUEUE_JOB_TIMEOUT_MS) {
      return helpers.error('any.invalid', {
        message:
          'QUEUE_SHUTDOWN_GRACE_MS must not exceed QUEUE_JOB_TIMEOUT_MS ' +
          `(got ${value.QUEUE_SHUTDOWN_GRACE_MS} > ${value.QUEUE_JOB_TIMEOUT_MS})`,
      });
    }

    return value;
  })
  .unknown(true);
