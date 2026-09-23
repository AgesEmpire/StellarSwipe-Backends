import {
  Controller,
  Get,
  HttpCode,
  OnApplicationBootstrap,
  Logger,
  UseGuards,
} from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
} from '@nestjs/terminus';
import { ReadinessService } from './readiness.service';
import {
  StellarHealthIndicator,
  SorobanHealthIndicator,
  DatabaseHealthIndicator,
  RedisHealthIndicator,
  QueueHealthIndicator,
  KafkaHealthIndicator,
  DatabasePoolHealthIndicator,
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
export class HealthController implements OnApplicationBootstrap {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private health: HealthCheckService,
    private stellarHealth: StellarHealthIndicator,
    private sorobanHealth: SorobanHealthIndicator,
    private databaseHealth: DatabaseHealthIndicator,
    private redisHealth: RedisHealthIndicator,
    private queueHealth: QueueHealthIndicator,
    private kafkaHealth: KafkaHealthIndicator,
    private databasePoolHealth: DatabasePoolHealthIndicator,
    private healthSummary: HealthSummaryService,
    private readiness: ReadinessService,
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
        // Issue #1038: mark ready only after startup work completes
        this.readiness.markReady();
        return;
      } catch (err) {
        this.readiness.markNotReady(`startup_check_failed:attempt_${attempt}`);
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

  @Get()
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.databaseHealth.isHealthy('database'),
      () => this.databasePoolHealth.isHealthy('database_pool'),
      () => this.redisHealth.isHealthy('cache'),
      () => this.stellarHealth.isHealthy('stellar'),
      () => this.sorobanHealth.isHealthy('soroban'),
      () => this.queueHealth.isHealthy('queue'),
      () => this.kafkaHealth.isHealthy('broker'),
    ]);
  }

  /**
   * Message broker (Kafka) health — kept out of readiness/ready since no
   * request path currently depends on it synchronously.
   */
  @Get('broker')
  @HealthCheck()
  async checkBroker(): Promise<HealthCheckResult> {
    return this.health.check([() => this.kafkaHealth.isHealthy('broker')]);
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
   * GET /health/live — explicit liveness endpoint (Issue #862).
   * Alias for /health/liveness. Returns 200 as long as the Node.js process is
   * running. Does NOT check any external dependencies so a DB outage never
   * triggers a pod restart.
   */
  @Get('live')
  @HealthCheck()
  async live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  /**
   * Readiness probe: returns 200 only when the app has completed startup AND
   * all critical dependencies are healthy. Returns 503 during startup, shutdown,
   * or dependency failure — distinguishing these from process death (liveness).
   * Issue #1038.
   */
  @Get('readiness')
  @HealthCheck()
  @HttpCode(200)
  async readiness(): Promise<HealthCheckResult & { ready: boolean; reason?: string }> {
    if (!this.readiness.isReady()) {
      const reason = this.readiness.getNotReadyReason() ?? 'not_ready';
      return { status: 'error', details: {}, error: {}, info: {}, ready: false, reason } as any;
    }
    const result = await this.health.check([
      () => this.databaseHealth.isHealthy('database'),
      () => this.databasePoolHealth.isHealthy('database_pool'),
      () => this.redisHealth.isHealthy('cache'),
      () => this.queueHealth.isHealthy('queue'),
    ]);
    return { ...result, ready: result.status === 'ok' };
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
