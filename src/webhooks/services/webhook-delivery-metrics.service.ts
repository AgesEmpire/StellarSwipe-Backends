import { Injectable, Optional } from '@nestjs/common';
import { Counter, Histogram, Registry } from 'prom-client';
import { PrometheusService } from '../../monitoring/metrics/prometheus.service';
import {
  WEBHOOK_MAX_ATTEMPTS,
  WebhookFailureKind,
} from '../jobs/webhook-delivery.constants';

export type WebhookAttemptOutcome = 'success' | WebhookFailureKind;
export type WebhookStatusClass = '2xx' | '3xx' | '4xx' | '5xx' | 'none';
export type WebhookFinalOutcome = 'delivered' | 'permanently_failed';

/** Attempt-duration buckets (seconds), spanning fast 2xx up to the 10s request timeout. */
const ATTEMPT_DURATION_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Prometheus instrumentation for outbound webhook delivery.
 *
 * Every label is drawn from a fixed, small set (outcome, HTTP status class,
 * failure kind, first-vs-retry), so series count stays bounded no matter how
 * many subscribers exist. Subscriber identifiers — webhook id, user id, URL,
 * delivery id — are deliberately never used as labels.
 *
 * Metrics:
 *   webhook_delivery_attempt_duration_seconds  histogram  outcome, status_class
 *   webhook_delivery_attempts_total            counter    outcome, status_class, retry
 *   webhook_delivery_retries_scheduled_total   counter    failure_kind
 *   webhook_delivery_final_outcomes_total      counter    outcome
 *   webhook_delivery_attempts_per_final_outcome histogram outcome
 */
@Injectable()
export class WebhookDeliveryMetricsService {
  readonly registry: Registry;

  private readonly attemptDuration: Histogram<'outcome' | 'status_class'>;
  private readonly attemptsTotal: Counter<'outcome' | 'status_class' | 'retry'>;
  private readonly retriesScheduled: Counter<'failure_kind'>;
  private readonly finalOutcomes: Counter<'outcome'>;
  private readonly attemptsPerFinalOutcome: Histogram<'outcome'>;

  constructor(@Optional() prometheus?: PrometheusService) {
    this.registry = prometheus?.registry ?? new Registry();

    this.attemptDuration = this.getOrCreate(
      'webhook_delivery_attempt_duration_seconds',
      (name, registers) =>
        new Histogram({
          name,
          help: 'Latency of individual outbound webhook delivery attempts',
          labelNames: ['outcome', 'status_class'],
          buckets: ATTEMPT_DURATION_BUCKETS,
          registers,
        }),
    );
    this.attemptsTotal = this.getOrCreate(
      'webhook_delivery_attempts_total',
      (name, registers) =>
        new Counter({
          name,
          help: 'Outbound webhook delivery attempts by outcome, status class and whether the attempt was a retry',
          labelNames: ['outcome', 'status_class', 'retry'],
          registers,
        }),
    );
    this.retriesScheduled = this.getOrCreate(
      'webhook_delivery_retries_scheduled_total',
      (name, registers) =>
        new Counter({
          name,
          help: 'Failed webhook attempts that were scheduled for another retry, by failure kind',
          labelNames: ['failure_kind'],
          registers,
        }),
    );
    this.finalOutcomes = this.getOrCreate(
      'webhook_delivery_final_outcomes_total',
      (name, registers) =>
        new Counter({
          name,
          help: 'Webhook deliveries that reached a terminal state',
          labelNames: ['outcome'],
          registers,
        }),
    );
    this.attemptsPerFinalOutcome = this.getOrCreate(
      'webhook_delivery_attempts_per_final_outcome',
      (name, registers) =>
        new Histogram({
          name,
          help: 'Number of attempts a webhook delivery took to reach a terminal state',
          labelNames: ['outcome'],
          buckets: Array.from({ length: WEBHOOK_MAX_ATTEMPTS }, (_, i) => i + 1),
          registers,
        }),
    );
  }

  static statusClass(status: number | undefined): WebhookStatusClass {
    if (status === undefined || status < 200 || status >= 600) return 'none';
    return `${Math.floor(status / 100)}xx` as WebhookStatusClass;
  }

  recordAttempt(params: {
    outcome: WebhookAttemptOutcome;
    status?: number;
    attempt: number;
    durationSeconds: number;
  }): void {
    const statusClass = WebhookDeliveryMetricsService.statusClass(params.status);
    this.attemptDuration.observe(
      { outcome: params.outcome, status_class: statusClass },
      Math.max(0, params.durationSeconds),
    );
    this.attemptsTotal.inc({
      outcome: params.outcome,
      status_class: statusClass,
      retry: params.attempt > 1 ? 'true' : 'false',
    });
  }

  recordRetryScheduled(kind: WebhookFailureKind): void {
    this.retriesScheduled.inc({ failure_kind: kind });
  }

  recordFinalOutcome(outcome: WebhookFinalOutcome, attempts: number): void {
    this.finalOutcomes.inc({ outcome });
    this.attemptsPerFinalOutcome.observe({ outcome }, Math.max(1, attempts));
  }

  /**
   * Reuses a metric already on the registry so a second instance (e.g. a
   * re-created testing module sharing PrometheusService) does not throw on
   * duplicate registration.
   */
  private getOrCreate<T>(
    name: string,
    create: (name: string, registers: Registry[]) => T,
  ): T {
    const existing = this.registry.getSingleMetric(name);
    return (existing as unknown as T) ?? create(name, [this.registry]);
  }
}
