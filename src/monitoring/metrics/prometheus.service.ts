import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';
import type { Queue } from 'bull';

@Injectable()
export class PrometheusService implements OnModuleInit, OnModuleDestroy {
  readonly registry: Registry;

  private readonly registeredQueues = new Map<string, Queue>();
  private queuePollInterval?: ReturnType<typeof setInterval>;

  // HTTP metrics
  readonly httpRequestsTotal: Counter;
  readonly httpRequestDuration: Histogram;
  readonly httpRequestErrorsTotal: Counter;

  // Business metrics
  readonly tradesExecutedTotal: Counter;
  readonly signalsCreatedTotal: Counter;
  readonly activeUsersGauge: Gauge;
  readonly portfolioValueTotal: Gauge;

  // Cache metrics
  readonly cacheHitsTotal: Counter;
  readonly cacheMissesTotal: Counter;

  // DB metrics
  readonly dbQueryDuration: Histogram;
  readonly dbConnectionsActive: Gauge;

  // DB connection pool metrics
  readonly dbPoolTotal: Gauge;
  readonly dbPoolActive: Gauge;
  readonly dbPoolIdle: Gauge;
  readonly dbPoolWaiting: Gauge;
  readonly dbPoolUtilizationRatio: Gauge;

  // Health check status gauges (1 = up, 0 = down)
  readonly serviceHealthStatus: Gauge;

  // Job queue metrics
  readonly jobQueueSize: Gauge;
  readonly jobQueueActive: Gauge;
  readonly jobQueueCompleted: Counter;
  readonly jobQueueFailed: Counter;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {
    this.registry = new Registry();
    this.registry.setDefaultLabels({ app: 'stellarswipe' });

    collectDefaultMetrics({ register: this.registry, prefix: 'nodejs_' });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status_code', 'service_type'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code', 'service_type'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.httpRequestErrorsTotal = new Counter({
      name: 'http_requests_errors_total',
      help: 'Total HTTP request errors',
      labelNames: ['method', 'route', 'status_code', 'service_type'],
      registers: [this.registry],
    });

    this.tradesExecutedTotal = new Counter({
      name: 'trades_executed_total',
      help: 'Total trades executed',
      labelNames: ['side', 'status'],
      registers: [this.registry],
    });

    this.signalsCreatedTotal = new Counter({
      name: 'signals_created_total',
      help: 'Total signals created',
      labelNames: ['type'],
      registers: [this.registry],
    });

    this.activeUsersGauge = new Gauge({
      name: 'active_users_gauge',
      help: 'Currently active users',
      registers: [this.registry],
    });

    this.portfolioValueTotal = new Gauge({
      name: 'portfolio_value_total',
      help: 'Total portfolio value across all users',
      registers: [this.registry],
    });

    this.cacheHitsTotal = new Counter({
      name: 'cache_hits_total',
      help: 'Total cache hits',
      labelNames: ['layer'],
      registers: [this.registry],
    });

    this.cacheMissesTotal = new Counter({
      name: 'cache_misses_total',
      help: 'Total cache misses',
      labelNames: ['layer'],
      registers: [this.registry],
    });

    this.dbQueryDuration = new Histogram({
      name: 'db_query_duration_seconds',
      help: 'Database query duration in seconds',
      labelNames: ['operation', 'entity'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      registers: [this.registry],
    });

    this.dbConnectionsActive = new Gauge({
      name: 'postgresql_connections_active',
      help: 'Active PostgreSQL connections',
      registers: [this.registry],
    });

    this.dbPoolTotal = new Gauge({
      name: 'db_pool_connections_total',
      help: 'Total connections in the database pool (active + idle)',
      registers: [this.registry],
    });

    this.dbPoolActive = new Gauge({
      name: 'db_pool_connections_active',
      help: 'Connections currently executing a query',
      registers: [this.registry],
    });

    this.dbPoolIdle = new Gauge({
      name: 'db_pool_connections_idle',
      help: 'Connections open but not executing a query',
      registers: [this.registry],
    });

    this.dbPoolWaiting = new Gauge({
      name: 'db_pool_connections_waiting',
      help: 'Connections waiting on a lock or client',
      registers: [this.registry],
    });

    this.dbPoolUtilizationRatio = new Gauge({
      name: 'db_pool_utilization_ratio',
      help: 'Ratio of total pool connections to configured maximum (0–1)',
      registers: [this.registry],
    });

    this.serviceHealthStatus = new Gauge({
      name: 'service_health_status',
      help: 'Health status of a service dependency (1 = up, 0 = down)',
      labelNames: ['service'],
      registers: [this.registry],
    });

    this.jobQueueSize = new Gauge({
      name: 'job_queue_waiting',
      help: 'Number of jobs waiting in the queue',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.jobQueueActive = new Gauge({
      name: 'job_queue_active',
      help: 'Number of jobs currently being processed',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.jobQueueCompleted = new Counter({
      name: 'job_queue_completed_total',
      help: 'Total jobs completed',
      labelNames: ['queue'],
      registers: [this.registry],
    });

    this.jobQueueFailed = new Counter({
      name: 'job_queue_failed_total',
      help: 'Total jobs that failed',
      labelNames: ['queue'],
      registers: [this.registry],
    });
  }

  onModuleInit(): void {
    // Poll DB connection count every 15s
    setInterval(async () => {
      try {
        const result = await this.dataSource.query(
          `SELECT count(*) FROM pg_stat_activity WHERE state = 'active'`,
        );
        this.dbConnectionsActive.set(parseInt(result[0].count, 10));
      } catch {
        // non-fatal
      }
    }, 15000);

    // Poll Bull queue sizes every 15s
    this.queuePollInterval = setInterval(() => this.pollQueueMetrics(), 15_000);
  }

  onModuleDestroy(): void {
    if (this.queuePollInterval) {
      clearInterval(this.queuePollInterval);
    }
  }

  /**
   * Register a Bull queue so its sizes are tracked automatically.
   * Call this from any module that owns a queue.
   */
  registerQueue(name: string, queue: Queue): void {
    this.registeredQueues.set(name, queue);
  }

  private async pollQueueMetrics(): Promise<void> {
    for (const [name, queue] of this.registeredQueues) {
      try {
        const counts = await queue.getJobCounts();
        this.jobQueueSize.set({ queue: name }, counts.waiting ?? 0);
        this.jobQueueActive.set({ queue: name }, counts.active ?? 0);
      } catch {
        // non-fatal — queue may be temporarily unavailable
      }
    }
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  observeHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number, serviceType = 'api'): void {
    const labels = { method, route, status_code: String(statusCode), service_type: serviceType };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, durationSeconds);
    if (statusCode >= 400) {
      this.httpRequestErrorsTotal.inc(labels);
    }
  }
}
