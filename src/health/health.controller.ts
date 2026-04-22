import { Controller, Get, OnApplicationBootstrap, Logger } from '@nestjs/common';
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
} from './indicators';
import { HealthSummaryService, ServiceHealthSummary } from './health-summary.service';

@Controller('health')
export class HealthController implements OnApplicationBootstrap {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private health: HealthCheckService,
    private stellarHealth: StellarHealthIndicator,
    private sorobanHealth: SorobanHealthIndicator,
    private databaseHealth: DatabaseHealthIndicator,
    private redisHealth: RedisHealthIndicator,
    private healthSummary: HealthSummaryService,
  ) { }

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
    ]);
  }

  @Get('stellar')
  @HealthCheck()
  async checkStellar(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.stellarHealth.isHealthy('stellar'),
    ]);
  }

  @Get('soroban')
  @HealthCheck()
  async checkSoroban(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.sorobanHealth.isHealthy('soroban'),
    ]);
  }

  @Get('db')
  @HealthCheck()
  async checkDatabase(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.databaseHealth.isHealthy('database'),
    ]);
  }

  @Get('cache')
  @HealthCheck()
  async checkCache(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.redisHealth.isHealthy('cache'),
    ]);
  }

  @Get('liveness')
  @HealthCheck()
  async liveness(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get('summary')
  async getHealthSummary(): Promise<ServiceHealthSummary> {
    return this.healthSummary.getHealthSummary();
  }

  @Get('readiness')
  @HealthCheck()
  async readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.databaseHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('cache'),
    ]);
  }
}
