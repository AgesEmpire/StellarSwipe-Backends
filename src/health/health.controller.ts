import {
  Controller,
  Get,
  HttpCode,
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
   * Readiness probe: returns 200 only when the app has completed startup AND
   * all critical dependencies are healthy. Returns 503 during startup, shutdown,
   * or dependency failure — distinguishing these from process death (liveness).
   * Issue #1038.
   *
   * Issue #1233: pending database migrations surface as a distinct readiness
   * failure (reason: 'pending_migrations') so schema incompatibility is
   * distinguishable from a generic database outage. Liveness is unaffected.
   */
  @Get('readiness')
  @HealthCheck()
  async readiness(): Promise<HealthCheckResult> {
    return this.runReadiness();
  @HttpCode(200)
  async readiness(): Promise<HealthCheckResult & { ready: boolean; reason?: string }> {
    if (!this.readiness.isReady()) {
      const reason = this.readiness.getNotReadyReason() ?? 'not_ready';
      return { status: 'error', details: {}, error: {}, info: {}, ready: false, reason } as any;
    }
    try {
      const result = await this.health.check([
        () => this.databaseHealth.isHealthy('database'),
        () => this.databasePoolHealth.isHealthy('database_pool'),
        () => this.redisHealth.isHealthy('cache'),
        () => this.queueHealth.isHealthy('queue'),
      ]);
      return { ...result, ready: result.status === 'ok' };
    } catch (err) {
      const message = (err as Error).message ?? '';
      // Distinguish pending migrations from a generic database outage without
      // leaking connection details or credentials.
      const reason = /migration/i.test(message)
        ? 'pending_migrations'
        : 'dependency_unavailable';
      this.logger.warn(`Readiness check failed (${reason})`);
      return {
        status: 'error',
        details: {},
        error: {},
        info: {},
        ready: false,
        reason,
      } as any;
    }
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
