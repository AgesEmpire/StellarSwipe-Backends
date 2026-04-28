import { Injectable, Logger } from '@nestjs/common';
import { BackupManagerService, BackupTier } from './services/backup-manager.service';
import { FailoverCoordinatorService, FailoverReport } from './services/failover-coordinator.service';
import { HealthMonitorService, SystemHealthSnapshot } from './services/health-monitor.service';
import { BackupVerificationJob } from './jobs/backup-verification.job';
import { FailoverTestJob } from './jobs/failover-test.job';

export interface DrStatus {
  healthy: boolean;
  lastHealthSnapshot: SystemHealthSnapshot | null;
  failoverInProgress: boolean;
  lastDrillResult: FailoverReport | null;
}

/**
 * DrService — façade over all DR sub-systems.
 * Consumed by admin endpoints and the NestJS health check controller.
 */
@Injectable()
export class DrService {
  private readonly logger = new Logger(DrService.name);

  constructor(
    private readonly backupManager: BackupManagerService,
    private readonly failoverCoordinator: FailoverCoordinatorService,
    private readonly healthMonitor: HealthMonitorService,
    private readonly backupVerificationJob: BackupVerificationJob,
    private readonly failoverTestJob: FailoverTestJob,
  ) {}

  // ── Status ──────────────────────────────────────────────────────────────────

  async getStatus(): Promise<DrStatus> {
    const snapshot = await this.healthMonitor.runAllChecks();
    const drillHistory = this.failoverTestJob.getDrillHistory();

    return {
      healthy: snapshot.overallHealthy,
      lastHealthSnapshot: snapshot,
      failoverInProgress: this.failoverCoordinator.isFailoverInProgress(),
      lastDrillResult: drillHistory.at(-1) ?? null,
    };
  }

  // ── Backups ─────────────────────────────────────────────────────────────────

  async triggerFullBackup() {
    this.logger.log('Manual full backup triggered via DrService');
    return this.backupManager.createFullBackup();
  }

  async triggerIncrementalBackup() {
    this.logger.log('Manual incremental backup triggered via DrService');
    return this.backupManager.createIncrementalBackup();
  }

  async verifyLatestBackup() {
    return this.backupVerificationJob.runManualVerification();
  }

  async pointInTimeRestore(targetTime: Date, targetDb: string) {
    this.logger.log(`PITR restore requested: targetTime=${targetTime.toISOString()} db=${targetDb}`);
    return this.backupManager.restoreToPointInTime(targetTime, targetDb);
  }

  async purgeExpiredBackups() {
    return this.backupManager.purgeExpiredBackups();
  }

  getLatestBackupPath(tier: BackupTier): string {
    return this.backupVerificationJob.getLastBackupTier(tier);
  }

  // ── Failover ────────────────────────────────────────────────────────────────

  async triggerManualFailover(): Promise<FailoverReport> {
    this.logger.warn('Manual failover triggered — this will affect production traffic');
    return this.failoverCoordinator.executeFailover(false);
  }

  async triggerFailback(): Promise<void> {
    this.logger.warn('Manual failback triggered');
    return this.failoverCoordinator.executeFailback(false);
  }

  // ── DR drills ───────────────────────────────────────────────────────────────

  async runDrDrill(): Promise<FailoverReport> {
    this.logger.log('On-demand DR drill triggered via DrService');
    return this.failoverTestJob.runManualDrill();
  }

  getDrillHistory(): FailoverReport[] {
    return this.failoverTestJob.getDrillHistory();
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  async runHealthChecks(): Promise<SystemHealthSnapshot> {
    return this.healthMonitor.runAllChecks();
  }
}
