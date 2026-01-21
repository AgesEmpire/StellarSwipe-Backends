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
    .valid('testnet', 'mainnet')
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

  // Sentry Configuration (Optional)
  SENTRY_DSN: Joi.string().uri().optional().allow(''),
  SENTRY_ENVIRONMENT: Joi.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),
});
