jest.mock('axios');
jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import axios, { AxiosError } from 'axios';
import { Registry } from 'prom-client';
import { PrometheusService } from '../../monitoring/metrics/prometheus.service';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { Webhook } from '../entities/webhook.entity';
import { WEBHOOK_MAX_ATTEMPTS } from '../jobs/webhook-delivery.constants';
import { WebhookDeliveryMetricsService } from './webhook-delivery-metrics.service';
import { WebhookSenderService } from './webhook-sender.service';

const mockedAxios = axios as jest.Mocked<typeof axios>;

const SUBSCRIBER_IDENTIFIERS = [
  'webhook-secret-id',
  'user-secret-id',
  'delivery-secret-id',
  'hooks.subscriber.example',
];

async function metricValues(registry: Registry, name: string) {
  const metric = registry.getSingleMetric(name);
  if (!metric) throw new Error(`metric ${name} not registered`);
  return (await metric.get()).values;
}

async function counterValue(
  registry: Registry,
  name: string,
  labels: Record<string, string>,
): Promise<number> {
  const values = await metricValues(registry, name);
  const match = values.find((v) =>
    Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return match?.value ?? 0;
}

async function histogramCount(
  registry: Registry,
  name: string,
  labels: Record<string, string>,
): Promise<number> {
  const values = await metricValues(registry, name);
  const match = values.find(
    (v) =>
      (v as { metricName?: string }).metricName === `${name}_count` &&
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
  );
  return match?.value ?? 0;
}

describe('WebhookDeliveryMetricsService', () => {
  it('maps HTTP statuses to bounded status classes', () => {
    expect(WebhookDeliveryMetricsService.statusClass(204)).toBe('2xx');
    expect(WebhookDeliveryMetricsService.statusClass(302)).toBe('3xx');
    expect(WebhookDeliveryMetricsService.statusClass(429)).toBe('4xx');
    expect(WebhookDeliveryMetricsService.statusClass(503)).toBe('5xx');
    expect(WebhookDeliveryMetricsService.statusClass(undefined)).toBe('none');
    expect(WebhookDeliveryMetricsService.statusClass(999)).toBe('none');
  });

  it('registers on the shared Prometheus registry and tolerates re-instantiation', () => {
    const registry = new Registry();
    const prometheus = { registry } as PrometheusService;

    new WebhookDeliveryMetricsService(prometheus);
    expect(() => new WebhookDeliveryMetricsService(prometheus)).not.toThrow();
    expect(
      registry.getSingleMetric('webhook_delivery_attempts_total'),
    ).toBeDefined();
  });
});

describe('WebhookSenderService delivery metrics', () => {
  let registry: Registry;
  let service: WebhookSenderService;
  let deliveryRepo: { save: jest.Mock; findOne: jest.Mock };
  let webhookRepo: { update: jest.Mock; increment: jest.Mock; findOne: jest.Mock };

  beforeEach(() => {
    mockedAxios.post.mockReset();
    const metrics = new WebhookDeliveryMetricsService();
    registry = metrics.registry;

    deliveryRepo = {
      save: jest.fn((value) => Promise.resolve(value)),
      findOne: jest.fn(),
    };
    webhookRepo = {
      update: jest.fn().mockResolvedValue(undefined),
      increment: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(undefined),
    };

    service = new WebhookSenderService(
      deliveryRepo as any,
      webhookRepo as any,
      { add: jest.fn() } as any,
      { generateSignature: jest.fn().mockReturnValue('sig') } as any,
      { emit: jest.fn() } as any,
      { send: jest.fn().mockResolvedValue(undefined) } as any,
      metrics,
    );
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest
        .spyOn((service as any).logger, level)
        .mockImplementation(() => undefined);
    }
  });

  afterEach(() => jest.restoreAllMocks());

  it('records latency, status class and final outcome for a successful attempt', async () => {
    deliveryRepo.findOne.mockResolvedValue(makeDelivery());
    mockedAxios.post.mockResolvedValue({ status: 204, data: {} });

    await service.deliverQueuedDelivery('delivery-secret-id', 1, false);

    expect(
      await counterValue(registry, 'webhook_delivery_attempts_total', {
        outcome: 'success',
        status_class: '2xx',
        retry: 'false',
      }),
    ).toBe(1);
    expect(
      await histogramCount(registry, 'webhook_delivery_attempt_duration_seconds', {
        outcome: 'success',
        status_class: '2xx',
      }),
    ).toBe(1);
    expect(
      await counterValue(registry, 'webhook_delivery_final_outcomes_total', {
        outcome: 'delivered',
      }),
    ).toBe(1);
    expect(
      await histogramCount(registry, 'webhook_delivery_attempts_per_final_outcome', {
        outcome: 'delivered',
      }),
    ).toBe(1);
  });

  it('records a timed-out attempt and a scheduled retry without a final outcome', async () => {
    deliveryRepo.findOne.mockResolvedValue(makeDelivery());
    mockedAxios.post.mockRejectedValue(
      makeAxiosError('timeout of 10000ms exceeded', { code: 'ETIMEDOUT' }),
    );

    await expect(
      service.deliverQueuedDelivery('delivery-secret-id', 1, false),
    ).rejects.toThrow('timeout');

    expect(
      await counterValue(registry, 'webhook_delivery_attempts_total', {
        outcome: 'timeout',
        status_class: 'none',
        retry: 'false',
      }),
    ).toBe(1);
    expect(
      await histogramCount(registry, 'webhook_delivery_attempt_duration_seconds', {
        outcome: 'timeout',
        status_class: 'none',
      }),
    ).toBe(1);
    expect(
      await counterValue(registry, 'webhook_delivery_retries_scheduled_total', {
        failure_kind: 'timeout',
      }),
    ).toBe(1);
    expect(
      await metricValues(registry, 'webhook_delivery_final_outcomes_total'),
    ).toHaveLength(0);
  });

  it('labels retry attempts and records the permanent failure on the final attempt', async () => {
    deliveryRepo.findOne.mockResolvedValue(makeDelivery());
    mockedAxios.post.mockRejectedValue(
      makeAxiosError('upstream down', { status: 503 }),
    );

    await expect(
      service.deliverQueuedDelivery('delivery-secret-id', WEBHOOK_MAX_ATTEMPTS, true),
    ).rejects.toThrow('upstream down');

    expect(
      await counterValue(registry, 'webhook_delivery_attempts_total', {
        outcome: 'http',
        status_class: '5xx',
        retry: 'true',
      }),
    ).toBe(1);
    expect(
      await counterValue(registry, 'webhook_delivery_final_outcomes_total', {
        outcome: 'permanently_failed',
      }),
    ).toBe(1);
    expect(
      await metricValues(registry, 'webhook_delivery_retries_scheduled_total'),
    ).toHaveLength(0);
  });

  it('instruments reconciliation retries through the same path', async () => {
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

    await expect(
      service.retryInPlace(makeDelivery({ attempts: 2 })),
    ).resolves.toBe(true);

    expect(
      await counterValue(registry, 'webhook_delivery_attempts_total', {
        outcome: 'success',
        status_class: '2xx',
        retry: 'true',
      }),
    ).toBe(1);
    expect(
      await counterValue(registry, 'webhook_delivery_final_outcomes_total', {
        outcome: 'delivered',
      }),
    ).toBe(1);
  });

  it('never exposes subscriber identifiers in metric output', async () => {
    deliveryRepo.findOne.mockResolvedValue(makeDelivery());
    mockedAxios.post
      .mockResolvedValueOnce({ status: 204, data: {} })
      .mockRejectedValueOnce(makeAxiosError('bad request', { status: 400 }));

    await service.deliverQueuedDelivery('delivery-secret-id', 1, false);
    await expect(
      service.deliverQueuedDelivery('delivery-secret-id', 2, false),
    ).rejects.toThrow();

    const exposition = await registry.metrics();
    for (const identifier of SUBSCRIBER_IDENTIFIERS) {
      expect(exposition).not.toContain(identifier);
    }
    expect(exposition).not.toMatch(/webhook_id|user_id|url=/);
  });
});

function makeWebhook(): Webhook {
  return {
    id: 'webhook-secret-id',
    userId: 'user-secret-id',
    url: 'https://hooks.subscriber.example/receive',
    secret: 'super-secret-signing-key-0123456789',
    active: true,
    consecutiveFailures: 0,
  } as Webhook;
}

function makeDelivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  const webhook = makeWebhook();
  return {
    id: 'delivery-secret-id',
    webhookId: webhook.id,
    webhook,
    eventType: 'trade.executed',
    eventId: 'event-1',
    payload: {
      event: 'trade.executed',
      timestamp: '2026-01-01T00:00:00.000Z',
      deliveryId: 'event-1',
      data: {},
    },
    status: 'pending',
    attempts: 0,
    ...overrides,
  } as WebhookDelivery;
}

function makeAxiosError(
  message: string,
  opts: { status?: number; code?: string },
): AxiosError {
  return Object.assign(new Error(message), {
    name: 'AxiosError',
    isAxiosError: true,
    code: opts.code,
    toJSON: () => ({}),
    response:
      opts.status === undefined
        ? undefined
        : ({ status: opts.status, data: {} } as AxiosError['response']),
  }) as AxiosError;
}
