import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BackupService, BackupType } from '../backup.service';

@Injectable()
export class BackupCleanupJob {
  private readonly logger = new Logger(BackupCleanupJob.name);

  constructor(private backupService: BackupService) {}

  @Cron('0 3 * * *', { timeZone: 'UTC' })
  async handleDailyCleanup(): Promise<void> {
    this.logger.log('Starting backup cleanup job...');
    try {
      await this.backupService.cleanupOldBackups(BackupType.DAILY, 7);
      await this.backupService.cleanupOldBackups(BackupType.WEEKLY, 28);
      await this.backupService.cleanupOldBackups(BackupType.MONTHLY, 365);
      this.logger.log('Backup cleanup completed successfully');
    } catch (error) {
      this.logger.error(`Backup cleanup failed: ${error.message}`);
    }
  }
}
