import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BackupService, BackupType } from '../backup.service';
import { JobSchedulerService } from '../../jobs/job-scheduler.service';
import { AdvisoryLockService } from '../../common/database/advisory-lock.service';
import { LockAcquisitionException } from '../../common/exceptions/lock-acquisition.exception';

const BACKUP_CLEANUP_LOCK_NAME = 'stellarswipe:maintenance:backup-cleanup';

@Injectable()
export class BackupCleanupJob implements OnModuleInit {
  private readonly logger = new Logger(BackupCleanupJob.name);

  constructor(
    private readonly backupService: BackupService,
    private readonly scheduler: JobSchedulerService,
    private readonly advisoryLockService: AdvisoryLockService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: 'backup.cleanup',
      cronEnvKey: 'CRON_BACKUP_CLEANUP',
      defaultCron: '0 3 * * *',
      handler: async () => {
        // Guards against two replicas (or a manual re-trigger during a
        // deploy) running cleanup against the same backup storage at once.
        try {
          await this.advisoryLockService.runExclusive(
            BACKUP_CLEANUP_LOCK_NAME,
            async () => {
              await this.backupService.cleanupOldBackups(BackupType.DAILY, 7);
              await this.backupService.cleanupOldBackups(BackupType.WEEKLY, 28);
              await this.backupService.cleanupOldBackups(BackupType.MONTHLY, 365);
            },
            { timeoutMs: 5_000 },
          );
        } catch (error) {
          if (error instanceof LockAcquisitionException) {
            this.logger.warn('Skipping backup cleanup — another instance already holds the lock');
            return;
          }
          throw error;
        }
      },
    });
  }
}
