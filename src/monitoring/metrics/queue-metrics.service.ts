import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Gauge } from 'prom-client';
import { PrometheusService } from './prometheus.service';

/**
 * QueueMetricsService
 *
 * Polls registered Bull queues on a configurable interval and exposes
 * per-queue job-count gauges to Prometheus.
 *
 * Metrics:
 *   bull_queue_jobs_waiting  – jobs waiting to be processed
 *   bull_queue_jobs_active   – jobs currently being processed
 *   bull_queue_jobs_completed – jobs successfully completed (rolling window)
 *   bull_queue_jobs_failed   – jobs that have failed
 *   bull_queue_jobs_delayed  – jobs scheduled for future execution
 */
@Injectable()
export class QueueMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueMetricsService.name);
  private readonly intervalMs = 15_000;
  private pollTimer?: ReturnType<typeof setInterval>;

  private waitingGauge!: Gauge;
  private activeGauge!: Gauge;
  private completedGauge!: Gauge;
  private failedGauge!: Gauge;
  private delayedGauge!: Gauge;

  constructor(
    private readonly prometheusService: PrometheusService,
    @InjectQueue('transactions') private readonly transactionsQueue: Queue,
  ) {}

  onModuleInit(): void {
    const registry = this.prometheusService.registry;
    const labelNames = ['queue'];

    this.waitingGauge = new Gauge({
      name: 'bull_queue_jobs_waiting',
      help: 'Number of jobs waiting to be processed in Bull queue',
      labelNames,
      registers: [registry],
    });

    this.activeGauge = new Gauge({
      name: 'bull_queue_jobs_active',
      help: 'Number of jobs currently being processed in Bull queue',
      labelNames,
      registers: [registry],
    });

    this.completedGauge = new Gauge({
      name: 'bull_queue_jobs_completed',
      help: 'Number of completed jobs in Bull queue (rolling window)',
      labelNames,
      registers: [registry],
    });

    this.failedGauge = new Gauge({
      name: 'bull_queue_jobs_failed',
      help: 'Number of failed jobs in Bull queue',
      labelNames,
      registers: [registry],
    });

    this.delayedGauge = new Gauge({
      name: 'bull_queue_jobs_delayed',
      help: 'Number of delayed (scheduled) jobs in Bull queue',
      labelNames,
      registers: [registry],
    });

    this.pollTimer = setInterval(() => this.collectAll(), this.intervalMs);
    // Collect immediately on startup
    void this.collectAll();

    this.logger.log('QueueMetricsService initialised');
  }

  onModuleDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private async collectAll(): Promise<void> {
    await this.collectQueue('transactions', this.transactionsQueue);
  }

  private async collectQueue(name: string, queue: Queue): Promise<void> {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      this.waitingGauge.set({ queue: name }, waiting);
      this.activeGauge.set({ queue: name }, active);
      this.completedGauge.set({ queue: name }, completed);
      this.failedGauge.set({ queue: name }, failed);
      this.delayedGauge.set({ queue: name }, delayed);
    } catch (err) {
      this.logger.warn(`Failed to collect metrics for queue "${name}": ${(err as Error).message}`);
    }
  }
}
