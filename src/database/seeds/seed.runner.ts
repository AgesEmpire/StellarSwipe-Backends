import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';

const logger = new Logger('SeedRunner');

export interface Seeder {
  run(dataSource: DataSource): Promise<void>;
}

/**
 * Runs all seed classes in order. Each seeder is idempotent (uses ON CONFLICT DO NOTHING).
 * Usage: npm run seed
 */
export async function runSeeders(
  dataSource: DataSource,
  seeders: Seeder[],
): Promise<void> {
  for (const seeder of seeders) {
    const name = seeder.constructor.name;
    try {
      logger.log(`Running seeder: ${name}`);
      await seeder.run(dataSource);
      logger.log(`Seeder completed: ${name}`);
    } catch (err: any) {
      logger.error(`Seeder failed: ${name} — ${err.message}`);
      throw err;
    }
  }
}
