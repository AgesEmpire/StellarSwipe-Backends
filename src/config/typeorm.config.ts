import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { join } from 'path';

// Load environment variables
config();

export const typeormConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'password',
  database: process.env.DATABASE_NAME || 'stellarswipe',
  entities: [join(__dirname, '..', '**', '*.entity{.ts,.js}')],
  migrations: [join(__dirname, '..', 'database', 'migrations', '*{.ts,.js}')],
  synchronize: false, // Always false for migrations
  logging: process.env.DATABASE_LOGGING === 'true',
  ssl:
    process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'mainnet'
      ? {
        rejectUnauthorized: false,
      }
      : undefined,
};

const dataSource = new DataSource(typeormConfig);

export default dataSource;
