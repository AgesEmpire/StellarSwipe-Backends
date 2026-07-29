import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BackupService } from './backup.service';
import { VerificationService } from './verification.service';
import { DatabaseBackupJob } from './jobs/database-backup.job';
import { BackupCleanupJob } from './jobs/backup-cleanup.job';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [ConfigModule, JobsModule],
  providers: [BackupService, VerificationService, DatabaseBackupJob, BackupCleanupJob],
  exports: [BackupService, VerificationService],
})
export class BackupModule {}
