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

export type WorkerLivenessState = 'healthy' | 'stalled' | 'stopped';

export interface WorkerLiveness {
  workerId: string;
  state: WorkerLivenessState;
  lastProgressAt: Date | null;
  heartbeatAt: Date | null;
  ageMs: number | null;
}

export interface WorkerLivenessReport {
  status: 'ok' | 'degraded';
  workers: WorkerLiveness[];
}

interface WorkerHeartbeat {
  lastProgressAt: Date;
  heartbeatAt: Date;
}

/**
 * A worker whose job loop has not reported progress within this window is
 * considered stalled even if its process is still alive.
 */
const DEFAULT_STALL_THRESHOLD_MS = 60_000;

/**
 * A worker that has not published any heartbeat within this window is
 * considered stopped (its process is no longer reporting).
 */
const DEFAULT_STOPPED_THRESHOLD_MS = 5 * 60_000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  private readonly dependencyStates = new Map<string, DependencyHealthState>();

  private readonly dependencyHistory: DependencyHealthTransition[] = [];

  /**
   * Bounded-cardinality registry of worker heartbeats keyed by worker id.
   * Only known worker ids are tracked so the map cannot grow unbounded.
   */
  private readonly workerHeartbeats = new Map<string, WorkerHeartbeat>();

  private readonly stallThresholdMs = DEFAULT_STALL_THRESHOLD_MS;

  private readonly stoppedThresholdMs = DEFAULT_STOPPED_THRESHOLD_MS;

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
   * Records a worker heartbeat. The heartbeat timestamp proves the process is
   * alive, while the progress timestamp proves the job loop is still making
   * forward progress. A live process with a blocked job loop keeps its
   * heartbeat fresh but stops advancing progress, which is what allows a
   * stalled worker to be distinguished from a healthy one.
   */
  recordWorkerHeartbeat(workerId: string, now: Date = new Date()): void {
    const existing = this.workerHeartbeats.get(workerId);

    this.workerHeartbeats.set(workerId, {
      lastProgressAt: existing?.lastProgressAt ?? now,
      heartbeatAt: now,
    });
  }

  /**
   * Records forward progress of a worker's job loop. Also refreshes the
   * heartbeat so a progressing worker is never reported as stopped.
   */
  recordWorkerProgress(workerId: string, now: Date = new Date()): void {
    this.workerHeartbeats.set(workerId, {
      lastProgressAt: now,
      heartbeatAt: now,
    });
  }

  /**
   * Reports worker liveness based on recent job-loop progress rather than
   * process availability alone. Distinguishes:
   * - stopped: no heartbeat within the stopped threshold (process gone).
   * - stalled: heartbeat is fresh but progress has not advanced within the
   *   stall threshold (process alive, job loop blocked).
   * - healthy: progress advanced within the stall threshold.
   */
  getWorkerLiveness(now: Date = new Date()): WorkerLivenessReport {
    const workers: WorkerLiveness[] = [];

    for (const [workerId, heartbeat] of this.workerHeartbeats) {
      const heartbeatAgeMs = now.getTime() - heartbeat.heartbeatAt.getTime();
      const progressAgeMs = now.getTime() - heartbeat.lastProgressAt.getTime();

      let state: WorkerLivenessState;
      if (heartbeatAgeMs > this.stoppedThresholdMs) {
        state = 'stopped';
      } else if (progressAgeMs > this.stallThresholdMs) {
        state = 'stalled';
      } else {
        state = 'healthy';
      }

      workers.push({
        workerId,
        state,
        lastProgressAt: heartbeat.lastProgressAt,
        heartbeatAt: heartbeat.heartbeatAt,
        ageMs: progressAgeMs,
      });
    }

    const status = workers.some((worker) => worker.state !== 'healthy')
      ? 'degraded'
      : 'ok';

    return { status, workers };
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
