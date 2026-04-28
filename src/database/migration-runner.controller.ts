import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { MigrationRunnerService } from './migration-runner.service';

@Controller('admin/migrations')
export class MigrationRunnerController {
  constructor(private readonly migrationRunner: MigrationRunnerService) {}

  @Get('status')
  async getStatus() {
    return this.migrationRunner.getMigrationStatus();
  }

  @Get('pending')
  async hasPending() {
    const pending = await this.migrationRunner.hasPendingMigrations();
    return { hasPendingMigrations: pending };
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  async runMigrations() {
    return this.migrationRunner.runMigrations();
  }

  @Post('revert')
  @HttpCode(HttpStatus.OK)
  async revertLastMigration() {
    return this.migrationRunner.revertLastMigration();
  }
}
