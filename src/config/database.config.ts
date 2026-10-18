import { registerAs } from '@nestjs/config';
import { DatabaseConfig, RedisConfig } from './schemas/config.interface';

/**
 * Resolve the request-scoped statement timeout (in milliseconds).
 *
 * The value is configured per environment via DATABASE_STATEMENT_TIMEOUT and
 * falls back to the write timeout so existing deployments keep a bounded
 * default. It is applied to request-scoped database operations so runaway
 * queries cannot hold pool capacity indefinitely.
 */
export const resolveStatementTimeoutMs = (): number => {
  const raw =
    process.env.DATABASE_STATEMENT_TIMEOUT ||
    process.env.DATABASE_WRITE_TIMEOUT_MS ||
    '10000';
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
};

export const databaseConfig = registerAs(
  'database',
  (): DatabaseConfig & Record<string, any> => ({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'password',
    database: process.env.DATABASE_NAME || 'stellarswipe',
    // Never auto-sync the schema outside of the test environment — all
    // schema changes must go through versioned migrations.
    synchronize: process.env.NODE_ENV === 'test',
    logging: process.env.DATABASE_LOGGING === 'true',
    readTimeoutMs: parseInt(process.env.DATABASE_READ_TIMEOUT_MS || '5000', 10),
    writeTimeoutMs: parseInt(process.env.DATABASE_WRITE_TIMEOUT_MS || '10000', 10),
    // Bounded statement timeout applied to request-scoped operations.
    statementTimeoutMs: resolveStatementTimeoutMs(),
    // TypeORM specific properties
    type: 'postgres',
    entities: ['dist/**/*.entity{.ts,.js}'],
    migrations: ['dist/migrations/*{.ts,.js}'],
    subscribers: ['dist/subscribers/*{.ts,.js}'],
    cli: {
      migrationsDir: 'src/migrations',
      subscribersDir: 'src/subscribers',
    },
    // Connection Pool Configuration (min: 10, max: 30 for 10k+ users)
    extra: {
      min: parseInt(process.env.DATABASE_POOL_MIN || '10', 10),
      max: parseInt(process.env.DATABASE_POOL_MAX || '30', 10),
      idleTimeoutMillis: parseInt(
        process.env.DATABASE_POOL_IDLE_TIMEOUT || '30000',
        10,
      ),
      connectionTimeoutMillis: parseInt(
        process.env.DATABASE_POOL_CONNECTION_TIMEOUT || '2000',
        10,
      ),
      statement_timeout: resolveStatementTimeoutMs(),
      query_timeout: parseInt(process.env.DATABASE_QUERY_TIMEOUT || '10000', 10),
    },
    // Query performance settings
    maxQueryExecutionTime: parseInt(
      process.env.DATABASE_MAX_QUERY_TIME || '10000',
      10,
    ),
    ssl:
      process.env.NODE_ENV === 'production' ||
      process.env.NODE_ENV === 'mainnet' ||
      process.env.NODE_ENV === 'public'
        ? {
            rejectUnauthorized: false,
          }
        : undefined,
    // Read replica configuration
    replica: {
      host: process.env.DATABASE_REPLICA_HOST || process.env.DATABASE_HOST || 'localhost',
      port: parseInt(process.env.DATABASE_REPLICA_PORT || process.env.DATABASE_PORT || '5432', 10),
      username: process.env.DATABASE_REPLICA_USER || process.env.DATABASE_USER || 'postgres',
      password: process.env.DATABASE_REPLICA_PASSWORD || process.env.DATABASE_PASSWORD || 'password',
      database: process.env.DATABASE_REPLICA_NAME || process.env.DATABASE_NAME || 'stellarswipe',
      // Issue #1371: maximum replication lag (ms) a replica may have before
      // freshness-sensitive analytics reads fall back to the primary.
      maxLagMs: parseInt(process.env.DATABASE_REPLICA_MAX_LAG_MS || '5000', 10),
      ssl:
        process.env.NODE_ENV === 'production' ||
        process.env.NODE_ENV === 'mainnet' ||
        process.env.NODE_ENV === 'public'
          ? {
              rejectUnauthorized: false,
            }
          : undefined,
    },
  }),
);

export const redisConfig = registerAs(
  'redis',
  (): RedisConfig & Record<string, any> => ({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    db: parseInt(process.env.REDIS_DB || '0', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    retryStrategy: (times: number) => Math.min(times * 50, 2000),
  }),
);
