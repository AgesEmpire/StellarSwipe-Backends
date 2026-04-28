import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FailoverCoordinatorService, FailoverReport } from '../services/failover-coordinator.service';
import { HealthMonitorService } from '../services/health-monitor.service';

/**
 * FailoverTestJob — implements the quarterly DR drill schedule and an
 * always-on health-polling loop.
 *
 * Schedule:
 *   - Health check poll  → every 2 minutes (automatic failover guard)
 *   - DR drill (Q1)      → 02:00 UTC on the first Monday of March
 *   - DR drill (Q2)      → 02:00 UTC on the first Monday of June
 *   - DR drill (Q3)      → 02:00 UTC on the first Monday of September
 *   - DR drill (Q4)      → 02:00 UTC on the first Monday of December
 */
@Injectable()
export class FailoverTestJob {
  private readonly logger = new Logger(FailoverTestJob.name);
  private drillHistory: FailoverReport[] = [];

  constructor(
    private readonly failover: FailoverCoordinatorService,
    private readonly healthMonitor: HealthMonitorService,
  ) {
    // Wire health-monitor → failover-coordinator
    this.healthMonitor.registerFailoverCallback(() =>
      this.failover.executeFailover(false).then(() => void 0),
    );
  }

  // ── Continuous health polling ───────────────────────────────────────────────
  @Cron('*/2 * * * *', { timeZone: 'UTC', name: 'dr-health-poll' })
  async handleHealthPoll(): Promise<void> {
    try {
      const snapshot = await this.healthMonitor.runAllChecks();

      if (!snapshot.overallHealthy) {
        this.logger.warn(
          `Health poll: ${snapshot.failureCount} component(s) unhealthy`,
          snapshot.checks.filter((c) => !c.healthy).map((c) => c.name),
        );
      }

      if (snapshot.failoverTriggered) {
        this.logger.error('Automatic failover triggered by health monitor');
      }
    } catch (err) {
      this.logger.error(`Health poll error: ${(err as Error).message}`);
    }
  }

  // ── Quarterly DR drills ─────────────────────────────────────────────────────

  /** Q1 drill — first Monday of March */
  @Cron('0 2 1-7 3 1', { timeZone: 'UTC', name: 'dr-drill-q1' })
  async handleQ1Drill(): Promise<void> {
    await this.executeDrDrill('Q1');
  }

  /** Q2 drill — first Monday of June */
  @Cron('0 2 1-7 6 1', { timeZone: 'UTC', name: 'dr-drill-q2' })
  async handleQ2Drill(): Promise<void> {
    await this.executeDrDrill('Q2');
  }

  /** Q3 drill — first Monday of September */
  @Cron('0 2 1-7 9 1', { timeZone: 'UTC', name: 'dr-drill-q3' })
  async handleQ3Drill(): Promise<void> {
    await this.executeDrDrill('Q3');
  }

  /** Q4 drill — first Monday of December */
  @Cron('0 2 1-7 12 1', { timeZone: 'UTC', name: 'dr-drill-q4' })
  async handleQ4Drill(): Promise<void> {
    await this.executeDrDrill('Q4');
  }

  // ── Manual trigger (admin API / on-demand test) ────────────────────────────
  async runManualDrill(): Promise<FailoverReport> {
    this.logger.log('DR drill triggered manually');
    return this.executeDrDrill('manual');
  }

  getDrillHistory(): FailoverReport[] {
    return [...this.drillHistory];
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async executeDrDrill(quarter: string): Promise<FailoverReport> {
    this.logger.log(`═══ DR Drill ${quarter} starting ═══`);
    this.logger.log('Pre-drill: Verifying current system state is healthy…');

    const snapshot = await this.healthMonitor.runAllChecks();
    if (!snapshot.overallHealthy) {
      this.logger.warn(
        `Pre-drill health check shows ${snapshot.failureCount} failure(s) — proceeding anyway in drill mode`,
      );
    }

    let report: FailoverReport;
    try {
      this.logger.log('Executing failover in DRILL mode (no real infrastructure changes)…');
      report = await this.failover.executeFailover(true);
    } catch (err) {
      this.logger.error(`DR drill ${quarter} failed to start: ${(err as Error).message}`);
      throw err;
    }

    this.logger.log('Executing failback (restoring to primary)…');
    try {
      await this.failover.executeFailback(true);
    } catch (err) {
      this.logger.warn(`Failback error during drill: ${(err as Error).message}`);
    }

    const rtoMs = report.totalDurationMs ?? 0;
    const rtoMinutes = (rtoMs / 60_000).toFixed(1);
    const rtoTarget = 15;

    this.logger.log(`═══ DR Drill ${quarter} complete ═══`);
    this.logger.log(`  Success     : ${report.success}`);
    this.logger.log(`  RTO achieved: ${rtoMinutes} min (target: <${rtoTarget} min)`);
    this.logger.log(`  RTO met     : ${parseFloat(rtoMinutes) < rtoTarget ? 'YES ✓' : 'NO — REVIEW REQUIRED'}`);

    if (!report.success || parseFloat(rtoMinutes) >= rtoTarget) {
      this.logger.error(
        `DR drill ${quarter} FAILED or missed RTO target. Immediate review required.`,
      );
    }

    this.drillHistory.push(report);
    // Keep last 8 drills (2 years)
    if (this.drillHistory.length > 8) this.drillHistory.shift();

    return report;
  }
}
