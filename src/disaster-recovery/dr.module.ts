import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DrService } from './dr.service';
import { BackupManagerService } from './services/backup-manager.service';
import { FailoverCoordinatorService } from './services/failover-coordinator.service';
import { HealthMonitorService } from './services/health-monitor.service';
import { BackupVerificationJob } from './jobs/backup-verification.job';
import { FailoverTestJob } from './jobs/failover-test.job';

@Module({
  imports: [
    ConfigModule,
    // ScheduleModule is already registered globally in BackupModule;
    // forRoot() is idempotent so calling it here is safe if BackupModule
    // is not imported in the same module context.
    ScheduleModule.forRoot(),
    // Provides the DataSource for HealthMonitorService
    TypeOrmModule.forFeature([]),
  ],
  providers: [
    DrService,
    BackupManagerService,
    FailoverCoordinatorService,
    HealthMonitorService,
    BackupVerificationJob,
    FailoverTestJob,
  ],
  exports: [DrService],
})
export class DrModule {}
