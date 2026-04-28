import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import axios from 'axios';
import Redis from 'ioredis';

export interface HealthCheckResult {
  name: string;
  healthy: boolean;
  latencyMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface SystemHealthSnapshot {
  timestamp: Date;
  overallHealthy: boolean;
  failureCount: number;
  checks: HealthCheckResult[];
  failoverTriggered: boolean;
}

// Number of consecutive failures across all checks before failover is triggered
const FAILOVER_THRESHOLD = 2;
// How many consecutive snapshot failures before a check is considered "in crisis"
const CONSECUTIVE_FAILURE_LIMIT = 3;

@Injectable()
export class HealthMonitorService {
  private readonly logger = new Logger(HealthMonitorService.name);

  private consecutiveFailures = 0;
  private lastSnapshot: SystemHealthSnapshot | null = null;
  private onFailoverCallback?: () => Promise<void>;

  private readonly redis: Redis;
  private readonly horizonUrl: string;
  private readonly apiBaseUrl: string;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.horizonUrl = config.get('STELLAR_HORIZON_URL', 'https://horizon.stellar.org');
    this.apiBaseUrl = config.get('DR_SELF_ENDPOINT', 'http://localhost:3000/api/v1');

    this.redis = new Redis({
      host: config.get('REDIS_HOST', 'localhost'),
      port: config.get<number>('REDIS_PORT', 6379),
      password: config.get('REDIS_PASSWORD'),
      db: config.get<number>('REDIS_DB', 0),
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 3_000,
      commandTimeout: 3_000,
    });
  }

  registerFailoverCallback(fn: () => Promise<void>): void {
    this.onFailoverCallback = fn;
  }

  // ── Individual checks ───────────────────────────────────────────────────────

  async checkDatabaseConnection(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      if (!this.dataSource.isInitialized) throw new Error('DataSource not initialized');
      await this.dataSource.query('SELECT 1 AS ping');
      return { name: 'database', healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { name: 'database', healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  async checkRedisConnection(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await this.redis.connect();
      const pong = await this.redis.ping();
      await this.redis.disconnect();
      return {
        name: 'redis',
        healthy: pong === 'PONG',
        latencyMs: Date.now() - start,
        details: { status: pong },
      };
    } catch (err) {
      try { await this.redis.disconnect(); } catch { /* ignore */ }
      return { name: 'redis', healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  async checkStellarNetwork(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      const { status, data } = await axios.get(`${this.horizonUrl}`, { timeout: 5_000 });
      return {
        name: 'stellar-network',
        healthy: status === 200,
        latencyMs: Date.now() - start,
        details: { history_latest_ledger: (data as Record<string, unknown>).history_latest_ledger },
      };
    } catch (err) {
      return { name: 'stellar-network', healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  async checkApiResponseTime(): Promise<HealthCheckResult> {
    const start = Date.now();
    const LATENCY_BUDGET_MS = 2_000;
    try {
      const { status } = await axios.get(`${this.apiBaseUrl}/health/liveness`, { timeout: LATENCY_BUDGET_MS });
      const latencyMs = Date.now() - start;
      return {
        name: 'api-response-time',
        healthy: status === 200 && latencyMs < LATENCY_BUDGET_MS,
        latencyMs,
        details: { budget_ms: LATENCY_BUDGET_MS },
      };
    } catch (err) {
      return { name: 'api-response-time', healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  async checkBackupStatus(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      // A backup is considered stale if no file was written to the backup dir
      // in the last 25 hours (daily backup cadence with 1-hour grace period)
      const { stdout } = await (async () => {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        return promisify(exec)(
          `find ${this.config.get('BACKUP_DIR', '/var/backups/stellarswipe/dr')} -name "*.gpg" -mmin -1500 | head -1`,
        );
      })();
      const healthy = stdout.trim().length > 0;
      return {
        name: 'backup-status',
        healthy,
        latencyMs: Date.now() - start,
        error: healthy ? undefined : 'No recent backup found (>25 h)',
      };
    } catch (err) {
      return { name: 'backup-status', healthy: false, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  // ── Composite check ─────────────────────────────────────────────────────────

  async runAllChecks(): Promise<SystemHealthSnapshot> {
    const settled = await Promise.allSettled([
      this.checkDatabaseConnection(),
      this.checkRedisConnection(),
      this.checkStellarNetwork(),
      this.checkApiResponseTime(),
      this.checkBackupStatus(),
    ]);

    const checks: HealthCheckResult[] = settled.map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : { name: 'unknown', healthy: false, latencyMs: 0, error: r.reason?.message },
    );

    const failureCount = checks.filter((c) => !c.healthy).length;
    const overallHealthy = failureCount === 0;

    if (!overallHealthy) {
      this.consecutiveFailures++;
      this.logger.warn(
        `Health check: ${failureCount} failure(s). Consecutive failure streak: ${this.consecutiveFailures}`,
        checks.filter((c) => !c.healthy).map((c) => `${c.name}: ${c.error}`),
      );
    } else {
      if (this.consecutiveFailures > 0) {
        this.logger.log('System healthy — resetting consecutive failure counter');
      }
      this.consecutiveFailures = 0;
    }

    let failoverTriggered = false;

    if (failureCount > FAILOVER_THRESHOLD && this.consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) {
      this.logger.error(
        `Failover threshold exceeded: ${failureCount} failures across ${this.consecutiveFailures} consecutive snapshots`,
      );
      await this.triggerFailover();
      failoverTriggered = true;
    }

    const snapshot: SystemHealthSnapshot = {
      timestamp: new Date(),
      overallHealthy,
      failureCount,
      checks,
      failoverTriggered,
    };

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  getLastSnapshot(): SystemHealthSnapshot | null {
    return this.lastSnapshot;
  }

  // ── Failover trigger ────────────────────────────────────────────────────────

  private async triggerFailover(): Promise<void> {
    if (this.onFailoverCallback) {
      try {
        await this.onFailoverCallback();
      } catch (err) {
        this.logger.error(`Failover callback error: ${(err as Error).message}`);
      }
    } else {
      this.logger.warn('No failover callback registered — logging only');
    }
  }
}
