import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type ReadinessStatus = 'ok' | 'pending_migrations' | 'database_unavailable';

export interface ReadinessResult {
  status: ReadinessStatus;
  ready: boolean;
  message: string;
}

export type DependencyHealthState = 'healthy' | 'unhealthy';

export interface DependencyHealthTransition {
  dependencyId: string;
  from: DependencyHealthState | null;
  to: DependencyHealthState;
  timestamp: Date;
}

export interface DependencyHealthAlert {
  dependencyId: string;
  from: DependencyHealthState | null;
  to: DependencyHealthState;
  timestamp: Date;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  private readonly dependencyStates = new Map<string, DependencyHealthState>();

  private readonly dependencyHistory: DependencyHealthTransition[] = [];

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

  /**
   * Records an external dependency health state transition for incident
   * analysis. Duplicate transitions (same state as the last known state) are
   * suppressed so history only contains real state changes. Each recorded
   * transition carries a timestamp and the dependency identifier, and is
   * forwarded to the alerting path so operators can correlate outages with
   * failed backend operations.
   */
  recordDependencyHealth(
    dependencyId: string,
    state: DependencyHealthState,
  ): DependencyHealthTransition | null {
    const previous = this.dependencyStates.get(dependencyId) ?? null;

    if (previous === state) {
      return null;
    }

    const transition: DependencyHealthTransition = {
      dependencyId,
      from: previous,
      to: state,
      timestamp: new Date(),
    };

    this.dependencyStates.set(dependencyId, state);
    this.dependencyHistory.push(transition);

    this.logger.warn(
      `Dependency health transition: ${dependencyId} ${previous ?? 'unknown'} -> ${state}`,
    );
    this.emitDependencyHealthAlert(transition);

    return transition;
  }

  /**
   * Returns the recorded dependency health state transitions, optionally
   * filtered to a single dependency, for incident analysis.
   */
  getDependencyHealthHistory(
    dependencyId?: string,
  ): DependencyHealthTransition[] {
    if (dependencyId === undefined) {
      return [...this.dependencyHistory];
    }

    return this.dependencyHistory.filter(
      (transition) => transition.dependencyId === dependencyId,
    );
  }

  /**
   * Alerting integration point for dependency health transitions. Kept as a
   * dedicated method so the alerting path can be overridden or tested.
   */
  protected emitDependencyHealthAlert(
    transition: DependencyHealthTransition,
  ): DependencyHealthAlert {
    return {
      dependencyId: transition.dependencyId,
      from: transition.from,
      to: transition.to,
      timestamp: transition.timestamp,
    };
  }
}
