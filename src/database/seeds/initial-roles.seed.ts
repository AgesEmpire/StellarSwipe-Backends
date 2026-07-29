import { DataSource } from 'typeorm';
import { Seeder } from './seed.runner';

/**
 * Seeds the standard roles needed for the application to function.
 * Idempotent: uses ON CONFLICT DO NOTHING.
 */
export class InitialRolesSeed implements Seeder {
  async run(dataSource: DataSource): Promise<void> {
    await dataSource.query(`
      INSERT INTO roles (id, name, description, "createdAt", "updatedAt")
      VALUES
        (uuid_generate_v4(), 'admin',    'Full system access',        now(), now()),
        (uuid_generate_v4(), 'trader',   'Standard trader account',   now(), now()),
        (uuid_generate_v4(), 'provider', 'Signal provider account',   now(), now()),
        (uuid_generate_v4(), 'viewer',   'Read-only access',          now(), now())
      ON CONFLICT (name) DO NOTHING
    `);
  }
}
