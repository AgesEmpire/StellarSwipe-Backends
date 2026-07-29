import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheckService,
  HealthCheckResult,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import {
  StellarHealthIndicator,
  SorobanHealthIndicator,
  DatabaseHealthIndicator,
  RedisHealthIndicator,
  QueueHealthIndicator,
} from './indicators';
import { PrometheusService } from '../monitoring/metrics/prometheus.service';
import { recordHealthCheck } from '../monitoring/metrics/custom-metrics';

export interface ServiceHealthSummary {
  overall: 'up' | 'down' | 'degraded';
  timestamp: string;
  services: {
    database: HealthStatus;
    cache: HealthStatus;
    stellar: HealthStatus;
    soroban: HealthStatus;
    queue: HealthStatus;
  };
  uptime: number;
  version: string;
}

export interface HealthStatus {
  status: 'up' | 'down';
  responseTime?: number;
  details?: Record<string, any>;
  lastChecked: string;
}

type HealthIndicatorResultWithResponseTime = Record<string, any> & {
  responseTime?: number;
};

/**
 * Creates a unified health summary endpoint for backend services and dependencies.
 * Provides comprehensive health status with detailed information about each service.
 */
@Injectable()
export class HealthSummaryService {
  private readonly logger = new Logger(HealthSummaryService.name);
  private readonly startupTime = Date.now();

  constructor(
    private health: HealthCheckService,
    private stellarHealth: StellarHealthIndicator,
    private sorobanHealth: SorobanHealthIndicator,
    private databaseHealth: DatabaseHealthIndicator,
    private redisHealth: RedisHealthIndicator,
    private queueHealth: QueueHealthIndicator,
    private prometheus: PrometheusService,
    private configService: ConfigService,
  ) {}

  async getHealthSummary(): Promise<ServiceHealthSummary> {
    const results = await Promise.allSettled([
      this.checkDatabase(),
      this.checkCache(),
      this.checkStellar(),
      this.checkSoroban(),
      this.checkQueue(),
    ]);

    const services: ServiceHealthSummary['services'] = {
      database: this.extractHealthStatus(results[0]),
      cache: this.extractHealthStatus(results[1]),
      stellar: this.extractHealthStatus(results[2]),
      soroban: this.extractHealthStatus(results[3]),
      queue: this.extractHealthStatus(results[4]),
    };

    const overall = this.determineOverallStatus(services);

    return {
      overall,
      timestamp: new Date().toISOString(),
      services,
      uptime: Date.now() - this.startupTime,
      version: this.configService.get<string>('npm_package_version') || '1.0.0',
    };
  }

  private async checkDatabase(): Promise<HealthIndicatorResultWithResponseTime> {
    const start = Date.now();
    try {
      const result = await this.databaseHealth.isHealthy('database');
      recordHealthCheck(this.prometheus, 'database', true);
      return { ...result, responseTime: Date.now() - start };
    } catch (error) {
      recordHealthCheck(this.prometheus, 'database', false);
      return {
        database: { status: 'down', error: (error as Error).message },
        responseTime: Date.now() - start,
      };
    }
  }

  private async checkCache(): Promise<HealthIndicatorResultWithResponseTime> {
    const start = Date.now();
    try {
      const result = await this.redisHealth.isHealthy('cache');
      recordHealthCheck(this.prometheus, 'cache', true);
      return { ...result, responseTime: Date.now() - start };
    } catch (error) {
      recordHealthCheck(this.prometheus, 'cache', false);
      return {
        cache: { status: 'down', error: (error as Error).message },
        responseTime: Date.now() - start,
      };
    }
  }

  private async checkStellar(): Promise<HealthIndicatorResultWithResponseTime> {
    const start = Date.now();
    try {
      const result = await this.stellarHealth.isHealthy('stellar');
      recordHealthCheck(this.prometheus, 'stellar', true);
      return { ...result, responseTime: Date.now() - start };
    } catch (error) {
      recordHealthCheck(this.prometheus, 'stellar', false);
      return {
        stellar: { status: 'down', error: (error as Error).message },
        responseTime: Date.now() - start,
      };
    }
  }

  private async checkSoroban(): Promise<HealthIndicatorResultWithResponseTime> {
    const start = Date.now();
    try {
      const result = await this.sorobanHealth.isHealthy('soroban');
      recordHealthCheck(this.prometheus, 'soroban', true);
      return { ...result, responseTime: Date.now() - start };
    } catch (error) {
      recordHealthCheck(this.prometheus, 'soroban', false);
      return {
        soroban: { status: 'down', error: (error as Error).message },
        responseTime: Date.now() - start,
      };
    }
  }

  private async checkQueue(): Promise<HealthIndicatorResultWithResponseTime> {
    const start = Date.now();
    try {
      const result = await this.queueHealth.isHealthy('queue');
      recordHealthCheck(this.prometheus, 'queue', true);
      return { ...result, responseTime: Date.now() - start };
    } catch (error) {
      recordHealthCheck(this.prometheus, 'queue', false);
      return {
        queue: { status: 'down', error: (error as Error).message },
        responseTime: Date.now() - start,
      };
    }
  }

  private extractHealthStatus(
    result: PromiseSettledResult<HealthIndicatorResultWithResponseTime>,
  ): HealthStatus {
    if (result.status === 'fulfilled') {
      const { responseTime, ...rest } = result.value;
      const serviceName = Object.keys(rest)[0];
      const serviceData = rest[serviceName];

      return {
        status: serviceData?.status === 'up' ? 'up' : 'down',
        responseTime,
        details: serviceData,
        lastChecked: new Date().toISOString(),
      };
    }

    return {
      status: 'down',
      details: { error: result.reason?.message || 'Unknown error' },
      lastChecked: new Date().toISOString(),
    };
  }

  private determineOverallStatus(
    services: ServiceHealthSummary['services'],
  ): 'up' | 'down' | 'degraded' {
    const statuses = Object.values(services).map((s) => s.status);

    if (statuses.every((s) => s === 'up')) return 'up';
    if (statuses.some((s) => s === 'down')) return 'down';
    return 'degraded';
  }
}
