import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type FailoverState =
  | 'idle'
  | 'detecting'
  | 'promoting'
  | 'updating-dns'
  | 'verifying'
  | 'complete'
  | 'failed';

export interface FailoverEvent {
  timestamp: Date;
  state: FailoverState;
  message: string;
  durationMs?: number;
}

export interface FailoverReport {
  triggeredAt: Date;
  completedAt?: Date;
  totalDurationMs?: number;
  success: boolean;
  events: FailoverEvent[];
  primaryRegion: string;
  secondaryRegion: string;
  newPrimaryIp?: string;
}

@Injectable()
export class FailoverCoordinatorService {
  private readonly logger = new Logger(FailoverCoordinatorService.name);

  private currentState: FailoverState = 'idle';
  private activeFailover: FailoverReport | null = null;

  private readonly primaryRegion: string;
  private readonly secondaryRegion: string;
  private readonly primaryHost: string;
  private readonly secondaryHost: string;
  private readonly apiDomain: string;
  private readonly alertWebhookUrl: string;
  private readonly route53HostedZoneId: string;

  constructor(private readonly config: ConfigService) {
    this.primaryRegion = config.get('DR_PRIMARY_REGION', 'us-east-1');
    this.secondaryRegion = config.get('DR_SECONDARY_REGION', 'eu-west-1');
    this.primaryHost = config.get('DR_PRIMARY_DB_HOST', '');
    this.secondaryHost = config.get('DR_SECONDARY_DB_HOST', '');
    this.apiDomain = config.get('DR_API_DOMAIN', 'api.stellarswipe.com');
    this.alertWebhookUrl = config.get('DR_ALERT_WEBHOOK_URL', '');
    this.route53HostedZoneId = config.get('DR_ROUTE53_HOSTED_ZONE_ID', '');
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  isFailoverInProgress(): boolean {
    return this.currentState !== 'idle' && this.currentState !== 'complete' && this.currentState !== 'failed';
  }

  getActiveFailover(): FailoverReport | null {
    return this.activeFailover;
  }

  async executeFailover(isDrillMode = false): Promise<FailoverReport> {
    if (this.isFailoverInProgress()) {
      throw new Error('Failover already in progress');
    }

    const report: FailoverReport = {
      triggeredAt: new Date(),
      success: false,
      events: [],
      primaryRegion: this.primaryRegion,
      secondaryRegion: this.secondaryRegion,
    };
    this.activeFailover = report;

    const log = (state: FailoverState, message: string, durationMs?: number) => {
      this.currentState = state;
      const event: FailoverEvent = { timestamp: new Date(), state, message, durationMs };
      report.events.push(event);
      this.logger[state === 'failed' ? 'error' : 'log'](
        `[Failover${isDrillMode ? ':DRILL' : ''}] ${state} — ${message}`,
      );
    };

    const start = Date.now();

    try {
      // ── Step 1: Confirm primary is down ──────────────────────────────────
      log('detecting', 'Verifying primary region health…');
      const primaryHealthy = await this.checkPrimaryHealth();
      if (primaryHealthy && !isDrillMode) {
        log('idle', 'Primary is healthy — aborting failover');
        report.success = false;
        return report;
      }
      log('detecting', primaryHealthy ? 'Primary healthy but drill mode active' : 'Primary confirmed unavailable');

      // ── Step 2: Confirm secondary readiness ───────────────────────────────
      log('detecting', 'Checking secondary region readiness…');
      const secondaryReady = await this.checkSecondaryReadiness();
      if (!secondaryReady) {
        throw new Error('Secondary is not ready for promotion');
      }
      log('detecting', `Secondary (${this.secondaryRegion}) is ready for promotion`);

      // ── Step 3: Promote secondary ─────────────────────────────────────────
      const promoteStart = Date.now();
      log('promoting', 'Promoting secondary PostgreSQL replica to primary…');
      const newPrimaryIp = await this.promoteSecondary(isDrillMode);
      report.newPrimaryIp = newPrimaryIp;
      log('promoting', `Promotion complete — new primary IP: ${newPrimaryIp}`, Date.now() - promoteStart);

      // ── Step 4: Update DNS ────────────────────────────────────────────────
      const dnsStart = Date.now();
      log('updating-dns', `Updating DNS record for ${this.apiDomain}…`);
      await this.updateDns(this.apiDomain, newPrimaryIp, isDrillMode);
      log('updating-dns', 'DNS update submitted (TTL propagation may take up to 60 s)', Date.now() - dnsStart);

      // ── Step 5: Verify new primary ────────────────────────────────────────
      log('verifying', 'Verifying new primary accepts connections…');
      await this.waitForNewPrimaryReady(newPrimaryIp, isDrillMode);
      log('verifying', 'New primary verified — accepting read/write traffic');

      // ── Step 6: Notify team ───────────────────────────────────────────────
      log('complete', 'Sending alert notifications…');
      await this.notifyTeam(report, isDrillMode);

      report.success = true;
      report.completedAt = new Date();
      report.totalDurationMs = Date.now() - start;
      log('complete', `Failover complete in ${report.totalDurationMs} ms`);

    } catch (err) {
      const message = (err as Error).message;
      log('failed', `Failover failed: ${message}`);
      report.completedAt = new Date();
      report.totalDurationMs = Date.now() - start;
      await this.notifyTeam(report, isDrillMode).catch(() => {/* best-effort */});
    }

    this.currentState = report.success ? 'complete' : 'failed';
    return report;
  }

  async executeFailback(isDrillMode = false): Promise<void> {
    this.logger.log(`Initiating failback to primary region ${this.primaryRegion}${isDrillMode ? ' (DRILL)' : ''}`);

    const primaryUp = await this.checkPrimaryHealth();
    if (!primaryUp && !isDrillMode) {
      throw new Error('Primary region is still unhealthy — cannot fail back');
    }

    await this.updateDns(this.apiDomain, this.primaryHost, isDrillMode);
    this.currentState = 'idle';
    this.activeFailover = null;
    this.logger.log('Failback complete — traffic routed back to primary region');
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async checkPrimaryHealth(): Promise<boolean> {
    if (!this.primaryHost) return false;
    try {
      const { stdout } = await execAsync(
        `pg_isready -h ${this.primaryHost} -p 5432 -t 5`,
      );
      return stdout.includes('accepting connections');
    } catch {
      return false;
    }
  }

  private async checkSecondaryReadiness(): Promise<boolean> {
    if (!this.secondaryHost) {
      this.logger.warn('DR_SECONDARY_DB_HOST not configured — treating as ready in non-production');
      return true;
    }
    try {
      const { stdout } = await execAsync(
        `pg_isready -h ${this.secondaryHost} -p 5432 -t 5`,
      );
      return stdout.includes('accepting connections') || stdout.includes('no response');
    } catch {
      return false;
    }
  }

  private async promoteSecondary(isDrillMode: boolean): Promise<string> {
    if (isDrillMode || !this.secondaryHost) {
      this.logger.log('DR drill — simulating pg_ctl promote');
      return this.secondaryHost || '10.0.2.100';
    }

    // In production: pg_ctl promote or trigger file approach
    await execAsync(`pg_ctl promote -D /var/lib/postgresql/data`).catch(() => {
      // Also try the trigger file approach for older PostgreSQL
    });

    await execAsync(`touch /tmp/postgresql.trigger.5432`).catch(() => {/* ignore */});

    return this.secondaryHost;
  }

  private async updateDns(domain: string, ip: string, isDrillMode: boolean): Promise<void> {
    if (isDrillMode) {
      this.logger.log(`DR drill — would set ${domain} → ${ip}`);
      return;
    }

    if (!this.route53HostedZoneId) {
      this.logger.warn('DR_ROUTE53_HOSTED_ZONE_ID not set — skipping DNS update');
      return;
    }

    const changeBatch = JSON.stringify({
      Changes: [{
        Action: 'UPSERT',
        ResourceRecordSet: {
          Name: domain,
          Type: 'A',
          TTL: 60,
          ResourceRecords: [{ Value: ip }],
        },
      }],
    });

    await execAsync(
      `aws route53 change-resource-record-sets --hosted-zone-id ${this.route53HostedZoneId} --change-batch '${changeBatch}'`,
    );

    this.logger.log(`DNS updated: ${domain} → ${ip}`);
  }

  private async waitForNewPrimaryReady(ip: string, isDrillMode: boolean): Promise<void> {
    if (isDrillMode) {
      this.logger.log('DR drill — skipping primary readiness wait');
      return;
    }

    const maxAttempts = 30;
    const intervalMs = 5_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const { stdout } = await execAsync(`pg_isready -h ${ip} -p 5432 -t 3`);
        if (stdout.includes('accepting connections')) return;
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error(`New primary at ${ip} did not become ready within ${(maxAttempts * intervalMs) / 1000} s`);
  }

  private async notifyTeam(report: FailoverReport, isDrillMode: boolean): Promise<void> {
    const icon = report.success ? '✅' : '❌';
    const subject = isDrillMode
      ? `[DR DRILL] ${icon} Failover ${report.success ? 'completed' : 'FAILED'}`
      : `[INCIDENT] ${icon} Failover ${report.success ? 'completed' : 'FAILED'}`;

    const body = {
      text: subject,
      attachments: [{
        color: report.success ? 'good' : 'danger',
        fields: [
          { title: 'Primary Region', value: report.primaryRegion, short: true },
          { title: 'Secondary Region', value: report.secondaryRegion, short: true },
          { title: 'Duration', value: `${report.totalDurationMs ?? 'N/A'} ms`, short: true },
          { title: 'New Primary IP', value: report.newPrimaryIp ?? 'N/A', short: true },
          { title: 'Events', value: report.events.map((e) => `${e.state}: ${e.message}`).join('\n'), short: false },
        ],
      }],
    };

    if (this.alertWebhookUrl) {
      await axios.post(this.alertWebhookUrl, body, { timeout: 5_000 }).catch((err) => {
        this.logger.warn(`Alert webhook failed: ${(err as Error).message}`);
      });
    } else {
      this.logger.warn('DR_ALERT_WEBHOOK_URL not set — alert not sent');
    }
  }
}
