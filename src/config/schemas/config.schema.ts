import * as Joi from 'joi';

/**
 * Shared NestJS configuration schema (Joi).
 *
 * Convention:
 *   - .required()          → must be present; startup fails with a clear message if missing.
 *   - .default(value)      → optional; documented default used when variable is absent.
 *   - .optional().allow('') → genuinely optional; may be empty.
 *
 * Non-sensitive defaults are listed inline so developers can understand
 * the expected values without consulting external documentation.
 */
export const configSchema = Joi.object({
  // ─── Application ────────────────────────────────────────────────────────────
  // Default: 'development' | Values: development | testnet | mainnet
  NODE_ENV: Joi.string()
    .valid('development', 'testnet', 'mainnet')
    .default('development'),
  // Default: 3000
  PORT: Joi.number().integer().positive().default(3000),
  // Default: '0.0.0.0'
  HOST: Joi.string().default('0.0.0.0'),
  // Default: 'api'
  API_PREFIX: Joi.string().default('api'),
  // Default: 'v1'
  API_VERSION: Joi.string().default('v1'),
  // Default: 50 (bps)
  SLIPPAGE_TOLERANCE_BPS: Joi.number().integer().min(0).default(50),

  // ─── Logging ────────────────────────────────────────────────────────────────
  // Default: 'info' | Values: error | warn | info | http | verbose | debug | silly
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly')
    .default('info'),
  // Default: './logs'
  LOG_DIRECTORY: Joi.string().default('./logs'),
  // Default: '14d'  (14 days of log rotation)
  LOG_MAX_FILES: Joi.string().default('14d'),
  // Default: '20m'  (20 MB per log file)
  LOG_MAX_SIZE: Joi.string().default('20m'),

  // ─── CORS ───────────────────────────────────────────────────────────────────
  // Default: 'http://localhost:3000'
  CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
  // Default: true
  CORS_CREDENTIALS: Joi.boolean().default(true),

  // ─── Database (PostgreSQL) — all required ───────────────────────────────────
  DATABASE_HOST: Joi.string().required(),
  // Default: 5432
  DATABASE_PORT: Joi.number().integer().positive().default(5432).required(),
  DATABASE_USER: Joi.string().required(),
  DATABASE_PASSWORD: Joi.string().required(),
  DATABASE_NAME: Joi.string().required(),
  // Default: false  (never auto-sync schema in production)
  DATABASE_LOGGING: Joi.boolean().default(false),

  // ─── Redis — required ───────────────────────────────────────────────────────
  // Default: 'localhost'
  REDIS_HOST: Joi.string().default('localhost').required(),
  // Default: 6379
  REDIS_PORT: Joi.number().integer().positive().default(6379).required(),
  // Default: 0  (Redis DB index)
  REDIS_DB: Joi.number().integer().min(0).default(0),
  REDIS_PASSWORD: Joi.string().optional().allow(''),

  // ─── Stellar Network — required ────────────────────────────────────────────
  // Default: 'testnet' | Values: testnet | public
  STELLAR_NETWORK: Joi.string()
    .valid('testnet', 'public')
    .default('testnet')
    .required(),
  STELLAR_HORIZON_URL: Joi.string().uri().required(),
  STELLAR_SOROBAN_RPC_URL: Joi.string().uri().required(),
  STELLAR_NETWORK_PASSPHRASE: Joi.string().required(),
  // Default: 30000 ms
  STELLAR_API_TIMEOUT: Joi.number().integer().positive().default(30000),
  // Default: 3 retries
  STELLAR_MAX_RETRIES: Joi.number().integer().min(0).default(3),

  // ─── JWT — required ─────────────────────────────────────────────────────────
  JWT_SECRET: Joi.string().min(32).required(),
  // Default: '7d'
  JWT_EXPIRES_IN: Joi.string().default('7d'),

  // ─── AI (xAI / Grok) — required ────────────────────────────────────────────
  XAI_API_KEY: Joi.string().required(),
  // Default: 'grok-2-1212'
  XAI_MODEL: Joi.string().default('grok-2-1212'),

  // ─── Sentry (optional) ─────────────────────────────────────────────────────
  SENTRY_DSN: Joi.string().uri().optional().allow(''),
  SENTRY_ENVIRONMENT: Joi.string().optional().allow(''),
  // Default: 0.1  (10 % of transactions sampled)
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),

  // ─── Encryption — required ──────────────────────────────────────────────────
  ENCRYPTION_KEY: Joi.string().min(32).required(),

  // ─── N+1 Detection (development mode only) ────────────────────────────────────
  // Default: 25 queries
  NPLUS1_MAX_QUERIES: Joi.number().integer().positive().default(25),
  // Default: 1000 ms
  NPLUS1_MAX_QUERY_TIME_MS: Joi.number().integer().positive().default(1000),
});
