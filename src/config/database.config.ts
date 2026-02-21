import { registerAs } from '@nestjs/config';
import { DatabaseConfig, RedisConfig } from './schemas/config.interface';

export const databaseConfig = registerAs(
  'database',
  (): DatabaseConfig & Record<string, any> => ({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'password',
    database: process.env.DATABASE_NAME || 'stellarswipe',
    synchronize:
      process.env.NODE_ENV !== 'production' &&
      process.env.NODE_ENV !== 'mainnet' &&
      process.env.NODE_ENV !== 'public',
    logging: process.env.DATABASE_LOGGING === 'true',
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
      statement_timeout: parseInt(
        process.env.DATABASE_STATEMENT_TIMEOUT || '100000',
        10,
      ),
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
