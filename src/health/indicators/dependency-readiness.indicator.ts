import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';

/**
 * Aggregated readiness check that verifies the service's external
 * dependencies (database, cache) are actually reachable, rather than
 * just reporting that the process is alive.
 */
@Injectable()
export class DependencyReadinessIndicator {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: Redis,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const checks: Record<string, boolean> = {};

    try {
      await this.dataSource.query('SELECT 1');
      checks.database = true;
    } catch {
      checks.database = false;
    }

    try {
      const pong = await this.redis.ping();
      checks.cache = pong === 'PONG';
    } catch {
      checks.cache = false;
    }

    const allHealthy = Object.values(checks).every(Boolean);
    const result = { [key]: { status: allHealthy ? 'up' : 'down', ...checks } };

    if (!allHealthy) {
      throw new HealthCheckError('Dependency readiness check failed', result);
    }

    return result;
  }
}
