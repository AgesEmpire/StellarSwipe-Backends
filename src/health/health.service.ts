import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type ReadinessStatus = 'ok' | 'pending_migrations' | 'database_unavailable';

export interface ReadinessResult {
  status: ReadinessStatus;
  ready: boolean;
  message: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Liveness must remain independent of database and migration state.
   * The process is alive as long as it can serve this check.
   */
  checkLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness verifies database connectivity and schema compatibility.
   * Pending migrations produce a distinct failure from a database outage,
   * and no connection details or credentials are surfaced in the response.
   */
  async checkReadiness(): Promise<ReadinessResult> {
    let hasPendingMigrations: boolean;

    try {
      hasPendingMigrations = await this.dataSource.showMigrations();
    } catch (error) {
      this.logger.error(
        `Readiness check failed: database unavailable (${(error as Error).name})`,
      );
      return {
        status: 'database_unavailable',
        ready: false,
        message: 'Database is unavailable',
      };
    }

    if (hasPendingMigrations) {
      this.logger.warn('Readiness check failed: pending database migrations');
      return {
        status: 'pending_migrations',
        ready: false,
        message: 'Pending database migrations must be applied',
      };
    }

    return {
      status: 'ok',
      ready: true,
      message: 'Ready',
    };
  }
}
