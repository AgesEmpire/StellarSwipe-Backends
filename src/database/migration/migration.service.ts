import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';

@Injectable()
export class MigrationService {
  private readonly logger = new Logger(MigrationService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async runMigrations(): Promise<void> {
    try {
      this.logger.log('Starting database migrations...');
      const migrations = await this.dataSource.runMigrations();
      this.logger.log(`Applied ${migrations.length} migrations successfully`);
    } catch (error) {
      this.logger.error('Migration failed:', error);
      throw error;
    }
  }

  async revertMigration(): Promise<void> {
    try {
      this.logger.log('Reverting last migration...');
      await this.dataSource.undoLastMigration();
      this.logger.log('Migration reverted successfully');
    } catch (error) {
      this.logger.error('Migration revert failed:', error);
      throw error;
    }
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