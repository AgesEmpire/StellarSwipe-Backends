import {
  Controller,
  Get,
  OnApplicationBootstrap,
  Logger,
  UseGuards,
  BeforeApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
} from '@nestjs/terminus';
import {
  StellarHealthIndicator,
  SorobanHealthIndicator,
  DatabaseHealthIndicator,
  RedisHealthIndicator,
  QueueHealthIndicator,
} from './indicators';
import {
  HealthSummaryService,
  ServiceHealthSummary,
} from './health-summary.service';
import { HealthMetricsAuthGuard } from '../common/guards/health-metrics-auth.guard';
import { AuditExempt } from '../audit-log/decorators/audit-exempt.decorator';

@Controller('health')
@UseGuards(HealthMetricsAuthGuard)
@AuditExempt()
export class HealthController
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(HealthController.name);
  /** Set once shutdown begins so readiness fails and traffic drains first. */
  private shuttingDown = false;

  constructor(
    private health: HealthCheckService,
    private stellarHealth: StellarHealthIndicator,
    private sorobanHealth: SorobanHealthIndicator,
    private databaseHealth: DatabaseHealthIndicator,
    private redisHealth: RedisHealthIndicator,
    private queueHealth: QueueHealthIndicator,
    private healthSummary: HealthSummaryService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const maxRetries = 5;
    const retryDelayMs = 3000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.health.check([
          () => this.databaseHealth.isHealthy('database'),
          () => this.redisHealth.isHealthy('cache'),
        ]);
        this.logger.log(
          'Startup health check passed: database and cache are ready',
        );
        return;
      } catch (err) {
        this.logger.warn(
          `Startup health check attempt ${attempt}/${maxRetries} failed: ${(err as Error).message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        } else {
          this.logger.error(
            'Critical dependencies unavailable after max retries — aborting startup',
          );
          process.exit(1);
        }
      }
    }
  }

  beforeApplicationShutdown(): void {
    this.shuttingDown = true;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /** Required dependencies — readiness fails if any of these is unavailable. */
  private readinessChecks() {
    return [
      () => this.databaseHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('cache'),
      () => this.queueHealth.isHealthy('queue'),
    ];
  }

  private async runReadiness(): Promise<HealthCheckResult> {
    if (this.shuttingDown) {
      throw new ServiceUnavailableException({
        status: 'error',
        error: { shutdown: { status: 'down', message: 'Instance is draining' } },
      });
    }
    return this.health.check(this.readinessChecks());
  }

  /** Liveness never touches dependencies — only reports that the process is responsive. */
  private liveResult(): HealthCheckResult {
    return {
      status: 'ok',
      info: { process: { status: 'up', uptimeSeconds: Math.round(process.uptime()) } },
      error: {},
      details: { process: { status: 'up', uptimeSeconds: Math.round(process.uptime()) } },
    };
  }

  @Get()
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.databaseHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('cache'),
      () => this.stellarHealth.isHealthy('stellar'),
      () => this.sorobanHealth.isHealthy('soroban'),
      () => this.queueHealth.isHealthy('queue'),
    ]);
  }

  @Get('stellar')
  @HealthCheck()
  async checkStellar(): Promise<HealthCheckResult> {
    return this.health.check([() => this.stellarHealth.isHealthy('stellar')]);
  }

  @Get('soroban')
  @HealthCheck()
  async checkSoroban(): Promise<HealthCheckResult> {
    return this.health.check([() => this.sorobanHealth.isHealthy('soroban')]);
  }

  @Get('db')
  @HealthCheck()
  async checkDatabase(): Promise<HealthCheckResult> {
    return this.health.check([() => this.databaseHealth.isHealthy('database')]);
  }

  @Get('cache')
  @HealthCheck()
  async checkCache(): Promise<HealthCheckResult> {
    return this.health.check([() => this.redisHealth.isHealthy('cache')]);
  }

  @Get('queue')
  @HealthCheck()
  async checkQueue(): Promise<HealthCheckResult> {
    return this.health.check([() => this.queueHealth.isHealthy('queue')]);
  }

  /**
   * Liveness probe: returns 200 as long as the process is running.
   * A non-empty check would cause unnecessary restarts on transient dependency failures.
   * Kubernetes uses this to decide whether to RESTART the pod.
   */
  @Get('liveness')
  liveness(): HealthCheckResult {
    return this.liveResult();
  }

  /**
   * GET /health/live — explicit liveness endpoint (Issue #862).
   * Alias for /health/liveness. Returns 200 as long as the Node.js process is
   * running. Does NOT check any external dependencies so a DB outage never
   * triggers a pod restart.
   */
  @Get('live')
  live(): HealthCheckResult {
    return this.liveResult();
  }

  /**
   * Readiness probe: returns 200 only when all critical dependencies are healthy.
   * Kubernetes uses this to decide whether to SEND TRAFFIC to the pod.
   * Includes database, cache, and queue — external blockchain services are excluded
   * to prevent unnecessary traffic removal on transient network issues.
   */
  @Get('readiness')
  @HealthCheck()
  async readiness(): Promise<HealthCheckResult> {
    return this.runReadiness();
  }

  /**
   * /healthz — alias for liveness (Kubernetes convention).
   */
  @Get('healthz')
  healthz(): HealthCheckResult {
    return this.liveResult();
  }

  /**
   * /ready — alias for readiness (Kubernetes convention). Uses the same required
   * dependency set; blockchain services are optional and reported via /health.
   */
  @Get('ready')
  @HealthCheck()
  async ready(): Promise<HealthCheckResult> {
    return this.runReadiness();
  }

  @Get('summary')
  async getHealthSummary(): Promise<ServiceHealthSummary> {
    return this.healthSummary.getHealthSummary();
  }
}
