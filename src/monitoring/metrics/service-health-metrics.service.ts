import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Dedicated service health metrics (error rate, latency, queue depth) for
 * production observability and operational monitoring dashboards/alerts.
 * Exposed on its own registry so it can be scraped independently of
 * business metrics.
 */
@Injectable()
export class ServiceHealthMetricsService {
  readonly registry: Registry;

  readonly requestsTotal: Counter;
  readonly errorsTotal: Counter;
  readonly requestLatencySeconds: Histogram;
  readonly queueDepth: Gauge;

  constructor() {
    this.registry = new Registry();

    this.requestsTotal = new Counter({
      name: 'service_health_requests_total',
      help: 'Total number of requests processed by the service',
      labelNames: ['service'],
      registers: [this.registry],
    });

    this.errorsTotal = new Counter({
      name: 'service_health_errors_total',
      help: 'Total number of errors encountered by the service',
      labelNames: ['service', 'error_type'],
      registers: [this.registry],
    });

    this.requestLatencySeconds = new Histogram({
      name: 'service_health_request_latency_seconds',
      help: 'Request latency in seconds',
      labelNames: ['service'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.queueDepth = new Gauge({
      name: 'service_health_queue_depth',
      help: 'Current number of pending items in a service queue',
      labelNames: ['queue'],
      registers: [this.registry],
    });
  }

  recordRequest(service: string): void {
    this.requestsTotal.inc({ service });
  }

  recordError(service: string, errorType: string): void {
    this.errorsTotal.inc({ service, error_type: errorType });
  }

  recordLatency(service: string, seconds: number): void {
    this.requestLatencySeconds.observe({ service }, seconds);
  }

  setQueueDepth(queue: string, depth: number): void {
    this.queueDepth.set({ queue }, depth);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
