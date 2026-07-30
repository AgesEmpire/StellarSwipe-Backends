import * as Joi from 'joi';

export type RuntimeEnvironment = 'development' | 'test' | 'testnet' | 'mainnet';
export type StellarNetwork = 'testnet' | 'public';
export type MaxCallDepthPolicy = 'reject' | 'warn';

export interface ValidatedEnvironment {
  NODE_ENV: RuntimeEnvironment;
  PORT: number;
  HOST: string;
  API_PREFIX: string;
  API_VERSION: string;
  LOG_LEVEL: 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';
  LOG_DIRECTORY: string;
  LOG_MAX_FILES: string;
  LOG_MAX_SIZE: string;
  CORS_ORIGIN: string;
  CORS_ALLOWED_ORIGINS?: string;
  CORS_CREDENTIALS: boolean;
  SLIPPAGE_TOLERANCE_BPS: number;
  DATABASE_HOST: string;
  DATABASE_PORT: number;
  DATABASE_USER: string;
  DATABASE_PASSWORD: string;
  DATABASE_NAME: string;
  DATABASE_LOGGING: boolean;
  DATABASE_POOL_MIN: number;
  DATABASE_POOL_MAX: number;
  DATABASE_POOL_IDLE_TIMEOUT: number;
  DATABASE_POOL_CONNECTION_TIMEOUT: number;
  DATABASE_STATEMENT_TIMEOUT: number;
  DATABASE_MAX_QUERY_TIME: number;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_DB: number;
  REDIS_PASSWORD?: string;
  STELLAR_NETWORK: StellarNetwork;
  STELLAR_HORIZON_URL: string;
  STELLAR_SOROBAN_RPC_URL: string;
  STELLAR_NETWORK_PASSPHRASE: string;
  STELLAR_API_TIMEOUT: number;
  STELLAR_MAX_RETRIES: number;
  STELLAR_MAX_CALL_DEPTH: number;
  STELLAR_MAX_CALL_DEPTH_POLICY: MaxCallDepthPolicy;
  STELLAR_HORIZON_READ_MAX_CONCURRENT: number;
  STELLAR_HORIZON_READ_MAX_QUEUE: number;
  STELLAR_HORIZON_WRITE_MAX_CONCURRENT: number;
  STELLAR_HORIZON_WRITE_MAX_QUEUE: number;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  JWT_EXPIRATION?: string;
  XAI_API_KEY: string;
  XAI_MODEL: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_TRACES_SAMPLE_RATE: number;
  ENCRYPTION_KEY: string;
  ENCRYPTION_KEY_PREVIOUS?: string;
  NPLUS1_MAX_QUERIES: number;
  NPLUS1_MAX_QUERY_TIME_MS: number;
  NPLUS1_LOG_IN_PRODUCTION: boolean;
  WEBHOOK_SIGNING_KEY?: string;
  MPESA_WEBHOOK_SECRET?: string;
  PAYSTACK_WEBHOOK_SECRET?: string;
}

export const configSchema = Joi.object<ValidatedEnvironment>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'testnet', 'mainnet')
    .default('development'),
  PORT: Joi.number().integer().min(1).max(65535).default(3000),
  HOST: Joi.string().hostname().default('0.0.0.0'),
  API_PREFIX: Joi.string().trim().min(1).default('api'),
  API_VERSION: Joi.string().trim().min(1).default('v1'),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly')
    .default('info'),
  LOG_DIRECTORY: Joi.string().default('./logs'),
  LOG_MAX_FILES: Joi.string().default('14d'),
  LOG_MAX_SIZE: Joi.string().default('20m'),
  CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
  CORS_ALLOWED_ORIGINS: Joi.string().optional().allow(''),
  CORS_CREDENTIALS: Joi.boolean().default(true),
  SLIPPAGE_TOLERANCE_BPS: Joi.number().integer().min(0).max(10000).default(50),

  DATABASE_HOST: Joi.string().required(),
  DATABASE_PORT: Joi.number().integer().min(1).max(65535).default(5432),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
  DATABASE_LOGGING: Joi.boolean().default(false),
  DATABASE_POOL_MIN: Joi.number().integer().min(0).max(1000).default(10),
  DATABASE_POOL_MAX: Joi.number()
    .integer()
    .min(Joi.ref('DATABASE_POOL_MIN'))
    .max(1000)
    .default(30),
  DATABASE_POOL_IDLE_TIMEOUT: Joi.number().integer().min(1000).default(30000),
  DATABASE_POOL_CONNECTION_TIMEOUT: Joi.number()
    .integer()
    .min(100)
    .default(2000),
  DATABASE_STATEMENT_TIMEOUT: Joi.number().integer().min(1000).default(100000),
  DATABASE_MAX_QUERY_TIME: Joi.number().integer().min(1).default(10000),

  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().integer().min(1).max(65535).default(6379),
  REDIS_DB: Joi.number().integer().min(0).max(15).default(0),
  REDIS_PASSWORD: Joi.string().optional().allow(''),

  STELLAR_NETWORK: Joi.string().valid('testnet', 'public').default('testnet'),
  STELLAR_HORIZON_URL: Joi.string().uri().required(),
  STELLAR_SOROBAN_RPC_URL: Joi.string().uri().required(),
  STELLAR_NETWORK_PASSPHRASE: Joi.string().required(),
  STELLAR_API_TIMEOUT: Joi.number().integer().min(1000).default(30000),
  STELLAR_MAX_RETRIES: Joi.number().integer().min(0).max(10).default(3),
  STELLAR_MAX_CALL_DEPTH: Joi.number().integer().min(1).max(50).default(5),
  STELLAR_MAX_CALL_DEPTH_POLICY: Joi.string()
    .valid('reject', 'warn')
    .default('reject'),
  STELLAR_HORIZON_READ_MAX_CONCURRENT: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(20),
  STELLAR_HORIZON_READ_MAX_QUEUE: Joi.number()
    .integer()
    .min(0)
    .max(10000)
    .default(100),
  STELLAR_HORIZON_WRITE_MAX_CONCURRENT: Joi.number()
    .integer()
    .min(1)
    .max(1000)
    .default(5),
  STELLAR_HORIZON_WRITE_MAX_QUEUE: Joi.number()
    .integer()
    .min(0)
    .max(10000)
    .default(25),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_EXPIRATION: Joi.string().optional().allow(''),

  XAI_API_KEY: Joi.string().required(),
  XAI_MODEL: Joi.string().default('grok-2-1212'),

  SENTRY_DSN: Joi.string().uri().optional().allow(''),
  SENTRY_ENVIRONMENT: Joi.string().optional().allow(''),
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),

  ENCRYPTION_KEY: Joi.string().min(32).required(),
  ENCRYPTION_KEY_PREVIOUS: Joi.string().optional().allow(''),

  NPLUS1_MAX_QUERIES: Joi.number().integer().min(1).max(1000).default(25),
  NPLUS1_MAX_QUERY_TIME_MS: Joi.number().integer().min(1).default(1000),
  NPLUS1_LOG_IN_PRODUCTION: Joi.boolean().default(false),

  WEBHOOK_SIGNING_KEY: Joi.string().min(32).optional().allow(''),
  MPESA_WEBHOOK_SECRET: Joi.string().min(16).optional().allow(''),
  PAYSTACK_WEBHOOK_SECRET: Joi.string().min(16).optional().allow(''),
});

export function validateEnvironment(
  config: Record<string, unknown>,
): ValidatedEnvironment {
  const { error, value } = configSchema.validate(config, {
    allowUnknown: true,
    abortEarly: false,
    convert: true,
  });

  if (error) {
    const messages = error.details.map((detail) => detail.message).join('; ');
    throw new Error(`Invalid application configuration: ${messages}`);
  }

  return value as ValidatedEnvironment;
}
