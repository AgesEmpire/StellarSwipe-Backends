import { Injectable, OnModuleInit } from '@nestjs/common';
import { BackupService, BackupType } from '../backup.service';
import { JobSchedulerService } from '../../jobs/job-scheduler.service';

@Injectable()
export class DatabaseBackupJob implements OnModuleInit {
  constructor(
    private readonly backupService: BackupService,
    private readonly scheduler: JobSchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: 'backup.daily',
      cronEnvKey: 'CRON_BACKUP_DAILY',
      defaultCron: '0 2 * * *',
      handler: () => this.backupService.createBackup(BackupType.DAILY).then(() => undefined),
    });

    this.scheduler.register({
      name: 'backup.weekly',
      cronEnvKey: 'CRON_BACKUP_WEEKLY',
      defaultCron: '0 2 * * 0',
      handler: () => this.backupService.createBackup(BackupType.WEEKLY).then(() => undefined),
    });

    this.scheduler.register({
      name: 'backup.monthly',
      cronEnvKey: 'CRON_BACKUP_MONTHLY',
      defaultCron: '0 2 1 * *',
      handler: () => this.backupService.createBackup(BackupType.MONTHLY).then(() => undefined),
    });
  }
}
