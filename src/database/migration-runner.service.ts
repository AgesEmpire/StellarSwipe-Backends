import { Injectable, Logger } from '@nestjs/common';
import { DataSource, MigrationInterface } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';

export interface MigrationStatus {
  name: string;
  timestamp: number;
  executed: boolean;
  executedAt?: Date;
}

export interface MigrationRunResult {
  executed: string[];
  skipped: string[];
  failed?: string;
}

@Injectable()
export class MigrationRunnerService {
  private readonly logger = new Logger(MigrationRunnerService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Run all pending migrations. Rolls back the last applied migration on failure.
   */
  async runMigrations(): Promise<MigrationRunResult> {
    this.logger.log('Starting migration run...');
    const executed: string[] = [];
    const skipped: string[] = [];

    try {
      const pending = await this.getPendingMigrations();

      if (pending.length === 0) {
        this.logger.log('No pending migrations found.');
        return { executed, skipped };
      }

      this.logger.log(`Found ${pending.length} pending migration(s): ${pending.map((m) => m.name).join(', ')}`);

      const results = await this.dataSource.runMigrations({ transaction: 'each' });

      for (const migration of results) {
        executed.push(migration.name);
        this.logger.log(`Migration executed: ${migration.name}`);
      }

      return { executed, skipped };
    } catch (error) {
      this.logger.error(`Migration run failed: ${error.message}`, error.stack);
      return { executed, skipped, failed: error.message };
    }
  }

  /**
   * Revert the last executed migration.
   */
  async revertLastMigration(): Promise<{ reverted: string | null; error?: string }> {
    this.logger.log('Reverting last migration...');

    try {
      const executedMigrations = await this.getExecutedMigrations();
      if (executedMigrations.length === 0) {
        this.logger.warn('No executed migrations to revert.');
        return { reverted: null };
      }

      const last = executedMigrations[executedMigrations.length - 1];
      await this.dataSource.undoLastMigration({ transaction: 'each' });

      this.logger.log(`Reverted migration: ${last.name}`);
      return { reverted: last.name };
    } catch (error) {
      this.logger.error(`Migration revert failed: ${error.message}`, error.stack);
      return { reverted: null, error: error.message };
    }
  }

  /**
   * Get status of all migrations (executed + pending).
   */
  async getMigrationStatus(): Promise<MigrationStatus[]> {
    const allMigrations = this.dataSource.migrations as MigrationInterface[];
    const executedMigrations = await this.getExecutedMigrations();
    const executedNames = new Set(executedMigrations.map((m) => m.name));

    return allMigrations.map((migration) => {
      const name = migration.constructor.name;
      const executed = executedMigrations.find((m) => m.name === name);
      // Extract timestamp from migration class name (e.g. CreateUsers1700000000000)
      const timestampMatch = name.match(/(\d{13})$/);
      const timestamp = timestampMatch ? parseInt(timestampMatch[1], 10) : 0;

      return {
        name,
        timestamp,
        executed: executedNames.has(name),
        executedAt: executed?.timestamp ? new Date(executed.timestamp) : undefined,
      };
    });
  }

  /**
   * Check if there are any pending migrations.
   */
  async hasPendingMigrations(): Promise<boolean> {
    const pending = await this.getPendingMigrations();
    return pending.length > 0;
  }

  private async getPendingMigrations(): Promise<MigrationInterface[]> {
    const allMigrations = this.dataSource.migrations as MigrationInterface[];
    const executedMigrations = await this.getExecutedMigrations();
    const executedNames = new Set(executedMigrations.map((m) => m.name));

    return allMigrations.filter(
      (m) => !executedNames.has(m.constructor.name),
    );
  }

  private async getExecutedMigrations(): Promise<Array<{ name: string; timestamp: number }>> {
    try {
      const queryRunner = this.dataSource.createQueryRunner();
      const migrationTableExists = await queryRunner.hasTable('migrations');
      await queryRunner.release();

      if (!migrationTableExists) return [];

      const rows = await this.dataSource.query(
        `SELECT name, timestamp FROM migrations ORDER BY timestamp ASC`,
      );
      return rows as Array<{ name: string; timestamp: number }>;
    } catch {
      return [];
    }
  }
}
