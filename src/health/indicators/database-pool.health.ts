import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConnectionPoolMetricsService } from '../../database/connection-pool.metrics.service';

@Injectable()
export class DatabasePoolHealthIndicator extends HealthIndicator {
  constructor(private readonly poolMetrics: ConnectionPoolMetricsService) {
    super();
  }

  isHealthy(key: string): HealthIndicatorResult {
    const snapshot = this.poolMetrics.getLastSnapshot();
    const ready = this.poolMetrics.isReady();
    const details = {
      initialized: snapshot !== null,
      active: snapshot?.active ?? 0,
      idle: snapshot?.idle ?? 0,
      pending: snapshot?.pending ?? 0,
      timedOut: snapshot?.timedOut ?? 0,
      utilizationRatio: snapshot?.utilizationRatio ?? 0,
    };

    if (!ready) {
      throw new HealthCheckError('Database connection pool is unavailable or saturated', this.getStatus(key, false, details));
    }

    return this.getStatus(key, true, details);
  }
}
