import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseHealthIndicator extends HealthIndicator {
  constructor(
    @InjectDataSource()
    private dataSource: DataSource,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const startTime = Date.now();

    try {
      const isConnected = this.dataSource.isInitialized;

      if (!isConnected) {
        throw new Error('Database connection not initialized');
      }

      await this.dataSource.query('SELECT 1 as health_check');
      const latency = Date.now() - startTime;

      return this.getStatus(key, true, {
        type: 'postgres',
        connected: true,
        latency: `${latency}ms`,
      });
    } catch (error) {
      const latency = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      throw new HealthCheckError(
        'Database check failed',
        this.getStatus(key, false, {
          type: 'postgres',
          connected: false,
          error: errorMessage,
          latency: `${latency}ms`,
        }),
      );
    }
  }
}
