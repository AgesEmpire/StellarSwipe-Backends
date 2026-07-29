import { Injectable, OnModuleInit } from '@nestjs/common';
import { BackupService, BackupType } from '../backup.service';
import { JobSchedulerService } from '../../jobs/job-scheduler.service';

@Injectable()
export class BackupCleanupJob implements OnModuleInit {
  constructor(
    private readonly backupService: BackupService,
    private readonly scheduler: JobSchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: 'backup.cleanup',
      cronEnvKey: 'CRON_BACKUP_CLEANUP',
      defaultCron: '0 3 * * *',
      handler: async () => {
        await this.backupService.cleanupOldBackups(BackupType.DAILY, 7);
        await this.backupService.cleanupOldBackups(BackupType.WEEKLY, 28);
        await this.backupService.cleanupOldBackups(BackupType.MONTHLY, 365);
      },
    });
  }
}
