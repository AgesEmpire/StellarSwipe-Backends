import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { AdvisoryLockService } from '../../common/database/advisory-lock.service';

/**
 * Advisory lock name shared by every process that could attempt to run or
 * revert migrations concurrently (deploy pods, CI jobs, manual CLI runs).
 * A single, well-known name means all callers coordinate on the same lock.
 */
const MIGRATIONS_LOCK_NAME = 'stellarswipe:migrations';

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly advisoryLockService: AdvisoryLockService,
  ) {}

  /**
   * Runs pending migrations while holding a Postgres advisory lock so a
   * second replica (or a scheduled maintenance job) started during the same
   * deployment window can't run migrations concurrently and corrupt schema
   * state. If the lock is already held, this throws LockAcquisitionException
   * (HTTP 409) instead of racing — see docs/guides/advisory-locking.md.
   */
  async runMigrations(): Promise<void> {
    await this.advisoryLockService.runExclusive(
      MIGRATIONS_LOCK_NAME,
      async () => {
        try {
          this.logger.log('Starting database migrations...');
          const migrations = await this.dataSource.runMigrations();
          this.logger.log(`Applied ${migrations.length} migrations successfully`);
        } catch (error) {
          this.logger.error('Migration failed:', error);
          throw error;
        }
      },
      { timeoutMs: 60_000 },
    );
  }

  async revertMigration(): Promise<void> {
    await this.advisoryLockService.runExclusive(
      MIGRATIONS_LOCK_NAME,
      async () => {
        try {
          this.logger.log('Reverting last migration...');
          await this.dataSource.undoLastMigration();
          this.logger.log('Migration reverted successfully');
        } catch (error) {
          this.logger.error('Migration revert failed:', error);
          throw error;
        }
      },
      { timeoutMs: 60_000 },
    );
  }

  async showMigrations(): Promise<any[]> {
    return await this.dataSource.showMigrations();
  }

  async getMigrationStatus(): Promise<{ pending: number; executed: number }> {
    const migrations = await this.dataSource.showMigrations();
    const executed = migrations.filter(m => m.timestamp).length;
    const pending = migrations.length - executed;
    return { pending, executed };
  }
}