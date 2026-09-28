import * as Joi from 'joi';

export const configSchema = Joi.object({
  // Application Configuration
  NODE_ENV: Joi.string()
    .valid('development', 'testnet', 'mainnet')
    .default('development')
    .required(),
  PORT: Joi.number().default(3000).required(),
  HOST: Joi.string().default('localhost'),
  API_PREFIX: Joi.string().default('api'),
  API_VERSION: Joi.string().default('v1'),

  // Logging Configuration
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly')
    .default('info'),
  LOG_DIRECTORY: Joi.string().default('./logs'),
  LOG_MAX_FILES: Joi.string().default('14d'),
  LOG_MAX_SIZE: Joi.string().default('20m'),

  // CORS Configuration
  CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
  CORS_CREDENTIALS: Joi.boolean().default(true),

  // Database Configuration
  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().default(5432).required(),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_LOGGING: Joi.boolean().default(false),

  // Redis Configuration
  REDIS_HOST: Joi.string().default('localhost').required(),
  REDIS_PORT: Joi.number().default(6379).required(),
  REDIS_DB: Joi.number().default(0),
  REDIS_PASSWORD: Joi.string().optional().allow(''),

  // Stellar Network Configuration
  STELLAR_NETWORK: Joi.string()
    .valid('testnet', 'public')
    .default('testnet')
    .required(),
  STELLAR_HORIZON_URL: Joi.string().uri().required(),
  STELLAR_SOROBAN_RPC_URL: Joi.string().uri().required(),
  STELLAR_NETWORK_PASSPHRASE: Joi.string().required(),
  STELLAR_API_TIMEOUT: Joi.number().default(30000),
  STELLAR_MAX_RETRIES: Joi.number().default(3),

  // JWT Configuration
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),

  // xAI Configuration
  XAI_API_KEY: Joi.string().required(),
  XAI_MODEL: Joi.string().default('grok-2-1212'),

  // Sentry Configuration (Optional)
  SENTRY_DSN: Joi.string().uri().optional().allow(''),
  SENTRY_ENVIRONMENT: Joi.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),

  // Encryption (at-rest field encryption)
  ENCRYPTION_KEY: Joi.string().min(32).required(),
})
  // Cross-field constraints
  .when(Joi.object({ NODE_ENV: Joi.valid('mainnet') }).unknown(), {
    then: Joi.object({
      STELLAR_NETWORK: Joi.valid('public').required().messages({
        'any.only': 'STELLAR_NETWORK must be "public" when NODE_ENV is "mainnet"',
      }),
      SENTRY_DSN: Joi.string().uri().required().messages({
        'any.required': 'SENTRY_DSN is required when NODE_ENV is "mainnet"',
        'string.empty': 'SENTRY_DSN is required when NODE_ENV is "mainnet"',
      }),
    }),
  })
  .custom((value, helpers) => {
    if (value.JWT_SECRET && value.JWT_SECRET === value.ENCRYPTION_KEY) {
      return helpers.message({ custom: 'ENCRYPTION_KEY must differ from JWT_SECRET' });
    }
    return value;
  });

export interface EnvironmentVariables {
  NODE_ENV: 'development' | 'testnet' | 'mainnet';
  PORT: number;
  HOST: string;
  API_PREFIX: string;
  API_VERSION: string;
  LOG_LEVEL: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';
  CORS_ORIGIN: string;
  CORS_CREDENTIALS: boolean;
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_USER: string;
  DATABASE_PASSWORD: string;
  DATABASE_NAME: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_DB: number;
  STELLAR_NETWORK: 'testnet' | 'public';
  STELLAR_HORIZON_URL: string;
  STELLAR_SOROBAN_RPC_URL: string;
  STELLAR_NETWORK_PASSPHRASE: string;
  JWT_SECRET: string;
  XAI_API_KEY: string;
  ENCRYPTION_KEY: string;
  [key: string]: unknown;
}

/**
 * ConfigModule `validate` hook: returns typed, defaulted values or throws a
 * single error listing every invalid field so deployments fail before serving traffic.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const { error, value } = configSchema.validate(config, {
    allowUnknown: true,
    abortEarly: false,
    convert: true,
  });
  if (error) {
    const fields = error.details
      .map((d) => `  - ${d.path.join('.') || '(root)'}: ${d.message}`)
      .join('\n');
    throw new Error(`Invalid runtime configuration:\n${fields}`);
  }
  return value as EnvironmentVariables;
}
