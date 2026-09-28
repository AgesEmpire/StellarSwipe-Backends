import { Controller, Post, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { MigrationService } from './migration.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';

@ApiTags('migrations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('migrations')
export class MigrationController {
  constructor(private readonly migrationService: MigrationService) {}

  @Post('run')
  @ApiOperation({ summary: 'Run pending migrations' })
  async runMigrations() {
    await this.migrationService.runMigrations();
    return { message: 'Migrations executed successfully' };
  }

  @Post('revert')
  @ApiOperation({ summary: 'Revert last migration' })
  async revertMigration() {
    await this.migrationService.revertMigration();
    return { message: 'Migration reverted successfully' };
  }

  @Get('status')
  @ApiOperation({ summary: 'Get migration status' })
  async getMigrationStatus() {
    return await this.migrationService.getMigrationStatus();
  }

  @Get()
  @ApiOperation({ summary: 'List all migrations' })
  async listMigrations() {
    return await this.migrationService.showMigrations();
  }
}