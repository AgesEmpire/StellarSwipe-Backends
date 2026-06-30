import { Controller, Get, OnApplicationBootstrap, Logger, UseGuards } from '@nestjs/common';
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
import { HealthSummaryService, ServiceHealthSummary } from './health-summary.service';
import { HealthMetricsAuthGuard } from '../common/guards/health-metrics-auth.guard';
import { AuditExempt } from '../audit-log/decorators/audit-exempt.decorator';

@Controller('health')
@UseGuards(HealthMetricsAuthGuard)
@AuditExempt()
export class HealthController implements OnApplicationBootstrap {
  private readonly logger = new Logger(HealthController.name);

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
        this.logger.log('Startup health check passed: database and cache are ready');
        return;
      } catch (err) {
        this.logger.warn(
          `Startup health check attempt ${attempt}/${maxRetries} failed: ${(err as Error).message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        } else {
          this.logger.error('Critical dependencies unavailable after max retries — aborting startup');
          process.exit(1);
        }
      }
    }
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
  @HealthCheck()
  async liveness(): Promise<HealthCheckResult> {
    return this.health.check([]);
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
    return this.health.check([
      () => this.databaseHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('cache'),
      () => this.queueHealth.isHealthy('queue'),
    ]);
  }

  /**
   * /healthz — alias for liveness (Kubernetes convention).
   */
  @Get('healthz')
  @HealthCheck()
  async healthz(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /**
   * /ready — alias for readiness (Kubernetes convention).
   */
  @Get('ready')
  @HealthCheck()
  async ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.databaseHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('cache'),
      () => this.queueHealth.isHealthy('queue'),
      () => this.sorobanHealth.isHealthy('soroban'),
      () => this.stellarHealth.isHealthy('stellar'),
    ]);
  }

  @Get('summary')
  async getHealthSummary(): Promise<ServiceHealthSummary> {
    return this.healthSummary.getHealthSummary();
  }
}
