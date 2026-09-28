/**
 * Standalone seed entry-point.
 * Usage:  npm run seed
 * The DATA_SOURCE env var can point to a custom typeorm config file.
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { runSeeders } from './seed.runner';
import { InitialRolesSeed } from './initial-roles.seed';

dotenv.config();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST || 'localhost',
  port: parseInt(process.env.DATABASE_PORT || '5432', 10),
  username: process.env.DATABASE_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || 'password',
  database: process.env.DATABASE_NAME || 'stellarswipe',
  entities: ['src/**/*.entity{.ts,.js}'],
  migrations: ['src/database/migrations/*{.ts,.js}'],
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : undefined,
});

async function main() {
  await AppDataSource.initialize();
  try {
    await runSeeders(AppDataSource, [new InitialRolesSeed()]);
    console.log('✅  All seeds completed successfully');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('❌  Seed failed:', err);
  process.exit(1);
});
