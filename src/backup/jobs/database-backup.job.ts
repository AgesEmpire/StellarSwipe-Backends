import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BackupService, BackupType } from '../backup.service';

@Injectable()
export class DatabaseBackupJob {
  private readonly logger = new Logger(DatabaseBackupJob.name);

  constructor(private backupService: BackupService) {}

  @Cron('0 2 * * *', { timeZone: 'UTC' })
  async handleDailyBackup(): Promise<void> {
    this.logger.log('Starting daily backup job...');
    try {
      await this.backupService.createBackup(BackupType.DAILY);
      this.logger.log('Daily backup completed successfully');
    } catch (error) {
      this.logger.error(`Daily backup failed: ${error.message}`);
    }
  }

  @Cron('0 2 * * 0', { timeZone: 'UTC' })
  async handleWeeklyBackup(): Promise<void> {
    this.logger.log('Starting weekly backup job...');
    try {
      await this.backupService.createBackup(BackupType.WEEKLY);
      this.logger.log('Weekly backup completed successfully');
    } catch (error) {
      this.logger.error(`Weekly backup failed: ${error.message}`);
    }
  }

  @Cron('0 2 1 * *', { timeZone: 'UTC' })
  async handleMonthlyBackup(): Promise<void> {
    this.logger.log('Starting monthly backup job...');
    try {
      await this.backupService.createBackup(BackupType.MONTHLY);
      this.logger.log('Monthly backup completed successfully');
    } catch (error) {
      this.logger.error(`Monthly backup failed: ${error.message}`);
    }
  }
}
