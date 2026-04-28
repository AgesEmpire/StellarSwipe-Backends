import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BackupManagerService, BackupTier } from '../services/backup-manager.service';

/**
 * BackupVerificationJob — runs on a scheduled cadence to:
 *   1. Trigger a fresh full or incremental backup.
 *   2. Restore it to an ephemeral test database.
 *   3. Run integrity probes against the restored data.
 *   4. Purge backups that have exceeded their retention period.
 *
 * Schedule:
 *   - Full backup    → 02:00 UTC daily
 *   - Incremental    → every hour (not during full-backup window)
 *   - Verification   → 04:00 UTC daily (runs against the backup created at 02:00)
 *   - Retention purge → 05:00 UTC daily
 */
@Injectable()
export class BackupVerificationJob {
  private readonly logger = new Logger(BackupVerificationJob.name);

  private lastFullBackupRecord: Awaited<ReturnType<BackupManagerService['createFullBackup']>> | null = null;

  constructor(private readonly backupManager: BackupManagerService) {}

  // ── Full backup — daily at 02:00 UTC ───────────────────────────────────────
  @Cron('0 2 * * *', { timeZone: 'UTC', name: 'dr-full-backup' })
  async handleFullBackup(): Promise<void> {
    this.logger.log('DR: Starting daily full backup…');
    try {
      this.lastFullBackupRecord = await this.backupManager.createFullBackup();
      this.logger.log(`DR: Full backup complete — ${this.lastFullBackupRecord.path}`);
    } catch (err) {
      this.logger.error(`DR: Full backup failed: ${(err as Error).message}`);
    }
  }

  // ── Incremental backup — every hour (skips 02:00 to avoid overlap) ─────────
  @Cron('0 0-1,3-23 * * *', { timeZone: 'UTC', name: 'dr-incremental-backup' })
  async handleIncrementalBackup(): Promise<void> {
    this.logger.log('DR: Starting incremental backup…');
    try {
      const record = await this.backupManager.createIncrementalBackup();
      this.logger.log(`DR: Incremental backup complete — ${record.path}`);
    } catch (err) {
      this.logger.error(`DR: Incremental backup failed: ${(err as Error).message}`);
    }
  }

  // ── Verification — daily at 04:00 UTC ─────────────────────────────────────
  @Cron('0 4 * * *', { timeZone: 'UTC', name: 'dr-backup-verification' })
  async handleVerification(): Promise<void> {
    if (!this.lastFullBackupRecord) {
      this.logger.warn('DR: No full backup record in memory — skipping verification this cycle');
      return;
    }

    this.logger.log(`DR: Verifying backup ${this.lastFullBackupRecord.id}…`);
    try {
      const passed = await this.backupManager.verifyBackup(this.lastFullBackupRecord);

      if (passed) {
        this.lastFullBackupRecord.verified = true;
        this.logger.log('DR: Backup verification passed ✓');
      } else {
        this.logger.error(
          'DR: Backup verification FAILED — integrity checks did not pass. Alerting on-call.',
        );
        // In production: emit an alert event or call an AlertService here
      }
    } catch (err) {
      this.logger.error(`DR: Verification job error: ${(err as Error).message}`);
    }
  }

  // ── Retention purge — daily at 05:00 UTC ──────────────────────────────────
  @Cron('0 5 * * *', { timeZone: 'UTC', name: 'dr-retention-purge' })
  async handleRetentionPurge(): Promise<void> {
    this.logger.log('DR: Starting retention purge…');
    try {
      const deleted = await this.backupManager.purgeExpiredBackups();
      this.logger.log(`DR: Purged ${deleted} expired backup file(s)`);
    } catch (err) {
      this.logger.error(`DR: Retention purge failed: ${(err as Error).message}`);
    }
  }

  // ── Manual trigger (used by DR drills / admin API) ─────────────────────────
  async runManualVerification(): Promise<{ passed: boolean; backupId: string | null }> {
    if (!this.lastFullBackupRecord) {
      return { passed: false, backupId: null };
    }
    const passed = await this.backupManager.verifyBackup(this.lastFullBackupRecord);
    return { passed, backupId: this.lastFullBackupRecord.id };
  }

  getLastBackupTier(tier: BackupTier): string {
    if (tier === BackupTier.FULL && this.lastFullBackupRecord) {
      return this.lastFullBackupRecord.path;
    }
    return 'unknown';
  }
}
