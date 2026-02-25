import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BackupService } from './backup.service';
import { DatabaseBackupJob } from './jobs/database-backup.job';
import { BackupCleanupJob } from './jobs/backup-cleanup.job';

@Module({
  imports: [ConfigModule, ScheduleModule.forRoot()],
  providers: [BackupService, DatabaseBackupJob, BackupCleanupJob],
  exports: [BackupService],
})
export class BackupModule {}
