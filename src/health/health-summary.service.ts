import { Injectable, Logger } from '@nestjs/common';
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
} from './indicators';

export interface ServiceHealthSummary {
  overall: 'up' | 'down' | 'degraded';
  timestamp: string;
  services: {
    database: HealthStatus;
    cache: HealthStatus;
    stellar: HealthStatus;
    soroban: HealthStatus;
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

/**
 * #388 — Health summary service for backend services and dependencies.
 *
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
  ) {}

  /**
   * Get comprehensive health summary of all services.
   */
  async getHealthSummary(): Promise<ServiceHealthSummary> {
    const results = await Promise.allSettled([
      this.checkDatabase(),
      this.checkCache(),
      this.checkStellar(),
      this.checkSoroban(),
    ]);

    const services: ServiceHealthSummary['services'] = {
      database: this.extractHealthStatus(results[0]),
      cache: this.extractHealthStatus(results[1]),
      stellar: this.extractHealthStatus(results[2]),
      soroban: this.extractHealthStatus(results[3]),
    };

    const overall = this.determineOverallStatus(services);

    return {
      overall,
      timestamp: new Date().toISOString(),
      services,
      uptime: Date.now() - this.startupTime,
      version: process.env.npm_package_version || '1.0.0',
    };
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    const start = Date.now();
    try {
      const result = await this.databaseHealth.isHealthy('database');
      return {
        ...result,
        responseTime: Date.now() - start,
      };
    } catch (error) {
      return {
        database: {
          status: 'down',
          error: (error as Error).message,
          responseTime: Date.now() - start,
        },
      };
    }
  }

  private async checkCache(): Promise<HealthIndicatorResult> {
    const start = Date.now();
    try {
      const result = await this.redisHealth.isHealthy('cache');
      return {
        ...result,
        responseTime: Date.now() - start,
      };
    } catch (error) {
      return {
        cache: {
          status: 'down',
          error: (error as Error).message,
          responseTime: Date.now() - start,
        },
      };
    }
  }

  private async checkStellar(): Promise<HealthIndicatorResult> {
    const start = Date.now();
    try {
      const result = await this.stellarHealth.isHealthy('stellar');
      return {
        ...result,
        responseTime: Date.now() - start,
      };
    } catch (error) {
      return {
        stellar: {
          status: 'down',
          error: (error as Error).message,
          responseTime: Date.now() - start,
        },
      };
    }
  }

  private async checkSoroban(): Promise<HealthIndicatorResult> {
    const start = Date.now();
    try {
      const result = await this.sorobanHealth.isHealthy('soroban');
      return {
        ...result,
        responseTime: Date.now() - start,
      };
    } catch (error) {
      return {
        soroban: {
          status: 'down',
          error: (error as Error).message,
          responseTime: Date.now() - start,
        },
      };
    }
  }

  private extractHealthStatus(result: PromiseSettledResult<HealthIndicatorResult>): HealthStatus {
    if (result.status === 'fulfilled') {
      const serviceName = Object.keys(result.value)[0];
      const serviceData = result.value[serviceName];

      return {
        status: serviceData.status === 'up' ? 'up' : 'down',
        responseTime: (result.value as any).responseTime,
        details: serviceData,
        lastChecked: new Date().toISOString(),
      };
    } else {
      return {
        status: 'down',
        details: { error: result.reason?.message || 'Unknown error' },
        lastChecked: new Date().toISOString(),
      };
    }
  }

  private determineOverallStatus(services: ServiceHealthSummary['services']): 'up' | 'down' | 'degraded' {
    const statuses = Object.values(services).map(s => s.status);

    if (statuses.every(status => status === 'up')) {
      return 'up';
    }

    if (statuses.some(status => status === 'down')) {
      return 'down';
    }

    return 'degraded';
  }
}