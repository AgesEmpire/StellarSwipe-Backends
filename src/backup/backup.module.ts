import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BackupService } from './backup.service';
import { VerificationService } from './verification.service';
import { DatabaseBackupJob } from './jobs/database-backup.job';
import { BackupCleanupJob } from './jobs/backup-cleanup.job';
import { BackupMonitoringService } from './backup-monitoring.service';

@Module({
  imports: [ConfigModule, ScheduleModule.forRoot()],
  providers: [BackupMonitoringService, BackupService, VerificationService, DatabaseBackupJob, BackupCleanupJob],
  exports: [BackupService, VerificationService, BackupMonitoringService],
})
export class BackupModule {}
