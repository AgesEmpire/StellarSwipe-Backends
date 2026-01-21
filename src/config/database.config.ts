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
    synchronize: process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'mainnet',
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
    ssl:
      process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'mainnet'
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
