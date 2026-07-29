jest.mock('axios');
jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { EventEmitter2 } from '@nestjs/event-emitter';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import axios, { AxiosError } from 'axios';
import { Queue } from 'bullmq';
import { NotificationChannel } from '../../notifications/entities/notification.entity';
import { NotificationService } from '../../notifications/notification.service';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { Webhook } from '../entities/webhook.entity';
import {
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_JOB_OPTIONS,
  WEBHOOK_DELIVERY_QUEUE,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_PERMANENTLY_FAILED_EVENT,
} from '../jobs/webhook-delivery.constants';
import { SignatureGeneratorService } from './signature-generator.service';
import { WebhookSenderService } from './webhook-sender.service';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('WebhookSenderService', () => {
  let service: WebhookSenderService;
  let deliveryRepo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
  };
  let webhookRepo: {
    update: jest.Mock;
    increment: jest.Mock;
    findOne: jest.Mock;
  };
  let deliveryQueue: {
    add: jest.Mock;
  };
  let signatureGenerator: {
    generateSignature: jest.Mock;
  };
  let eventEmitter: {
    emit: jest.Mock;
  };
  let notificationService: {
    send: jest.Mock;
  };

  beforeEach(async () => {
    mockedAxios.post.mockReset();

    deliveryRepo = {
      create: jest.fn((value) => ({ id: 'delivery-1', ...value })),
      save: jest.fn((value) => Promise.resolve(value)),
      findOne: jest.fn(),
    };
    webhookRepo = {
      update: jest.fn().mockResolvedValue(undefined),
      increment: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(),
    };
    deliveryQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    };
    signatureGenerator = {
      generateSignature: jest.fn().mockReturnValue('signed-payload'),
    };
    eventEmitter = {
      emit: jest.fn().mockReturnValue(true),
    };
    notificationService = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookSenderService,
        {
          provide: getRepositoryToken(WebhookDelivery),
          useValue: deliveryRepo,
        },
        { provide: getRepositoryToken(Webhook), useValue: webhookRepo },
        {
          provide: getQueueToken(WEBHOOK_DELIVERY_QUEUE),
          useValue: deliveryQueue,
        },
        { provide: SignatureGeneratorService, useValue: signatureGenerator },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: NotificationService, useValue: notificationService },
      ],
    }).compile();

    service = module.get(WebhookSenderService);
    jest
      .spyOn((service as any).logger, 'log')
      .mockImplementation(() => undefined);
    jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('queueing', () => {
    it('creates a pending delivery and enqueues a BullMQ delivery job', async () => {
      const webhook = makeWebhook();
      const payload = makePayload();

      await service.deliverWebhook(webhook, payload);

      expect(deliveryRepo.create).toHaveBeenCalledWith({
        webhookId: webhook.id,
        eventType: payload.event,
        eventId: payload.deliveryId,
        payload,
        status: 'pending',
        attempts: 0,
      });
      expect(deliveryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'delivery-1',
          webhookId: webhook.id,
          status: 'pending',
          attempts: 0,
        }),
      );
      expect(deliveryQueue.add).toHaveBeenCalledWith(
        WEBHOOK_DELIVERY_JOB,
        { deliveryId: 'delivery-1', manualRetry: false },
        WEBHOOK_DELIVERY_JOB_OPTIONS,
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('manual retry requeues an existing active delivery', async () => {
      const delivery = makeDelivery({
        status: 'failed',
        nextRetryAt: new Date('2026-01-01T00:00:00.000Z'),
        errorMessage: 'previous failure',
      });
      deliveryRepo.findOne.mockResolvedValue(delivery);

      await service.retryDelivery(delivery.id);

      expect(deliveryRepo.findOne).toHaveBeenCalledWith({
        where: { id: delivery.id },
        relations: ['webhook'],
      });
      expect(deliveryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: delivery.id,
          status: 'pending',
          nextRetryAt: undefined,
          errorMessage: undefined,
        }),
      );
      expect(deliveryQueue.add).toHaveBeenCalledWith(
        WEBHOOK_DELIVERY_JOB,
        { deliveryId: delivery.id, manualRetry: true },
        WEBHOOK_DELIVERY_JOB_OPTIONS,
      );
    });

    it('rejects manual retry when the webhook registration is inactive', async () => {
      deliveryRepo.findOne.mockResolvedValue(
        makeDelivery({
          webhook: makeWebhook({ active: false }),
        }),
      );

      await expect(service.retryDelivery('delivery-1')).rejects.toThrow(
        'Cannot retry delivery for an inactive webhook',
      );

      expect(deliveryQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('queued delivery attempts', () => {
    it('performs one HTTP attempt and records success', async () => {
      const delivery = makeDelivery();
      deliveryRepo.findOne.mockResolvedValue(delivery);
      mockedAxios.post.mockResolvedValue({
        status: 204,
        data: { accepted: true },
      });

      await service.deliverQueuedDelivery(delivery.id, 1, false);

      expect(signatureGenerator.generateSignature).toHaveBeenCalledWith(
        delivery.payload,
        delivery.webhook.secret,
      );
      expect(mockedAxios.post).toHaveBeenCalledWith(
        delivery.webhook.url,
        delivery.payload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-StellarSwipe-Signature': 'sha256=signed-payload',
            'X-StellarSwipe-Event': delivery.eventType,
            'X-StellarSwipe-Delivery-Id': delivery.eventId,
          },
          timeout: 5000,
        },
      );
      expect(deliveryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: delivery.id,
          attempts: 1,
          status: 'success',
          responseStatus: 204,
          responseBody: JSON.stringify({ accepted: true }),
          nextRetryAt: undefined,
          errorMessage: undefined,
        }),
      );
      expect(webhookRepo.update).toHaveBeenCalledWith(delivery.webhook.id, {
        consecutiveFailures: 0,
      });
    });

    it('records a non-final failure and schedules the next retry with jittered backoff', async () => {
      const now = new Date('2026-01-01T00:00:00.000Z').getTime();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      const delivery = makeDelivery();
      deliveryRepo.findOne.mockResolvedValue(delivery);
      mockedAxios.post.mockRejectedValue(
        makeAxiosError('provider unavailable', 503, { error: 'down' }),
      );

      await expect(
        service.deliverQueuedDelivery(delivery.id, 2, false),
      ).rejects.toThrow('provider unavailable');

      expect(deliveryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: delivery.id,
          attempts: 2,
          status: 'failed',
          responseStatus: 503,
          responseBody: JSON.stringify({ error: 'down' }),
          errorMessage: 'provider unavailable',
          nextRetryAt: new Date(now + 4500),
        }),
      );
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(notificationService.send).not.toHaveBeenCalled();
    });

    it('marks the delivery permanently failed after the final attempt', async () => {
      const delivery = makeDelivery({
        webhook: makeWebhook({ consecutiveFailures: 9 }),
      });
      deliveryRepo.findOne.mockResolvedValue(delivery);
      webhookRepo.findOne.mockResolvedValue(
        makeWebhook({ consecutiveFailures: 10 }),
      );
      mockedAxios.post.mockRejectedValue(
        makeAxiosError('connection refused', 500, { message: 'no listener' }),
      );

      await expect(
        service.deliverQueuedDelivery(delivery.id, WEBHOOK_MAX_ATTEMPTS, true),
      ).rejects.toThrow('connection refused');

      expect(deliveryRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: delivery.id,
          attempts: WEBHOOK_MAX_ATTEMPTS,
          status: 'permanently_failed',
          responseStatus: 500,
          responseBody: JSON.stringify({ message: 'no listener' }),
          errorMessage: 'connection refused',
          nextRetryAt: undefined,
        }),
      );
      expect(webhookRepo.increment).toHaveBeenCalledWith(
        { id: delivery.webhook.id },
        'consecutiveFailures',
        1,
      );
      expect(webhookRepo.update).toHaveBeenCalledWith(delivery.webhook.id, {
        active: false,
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WEBHOOK_PERMANENTLY_FAILED_EVENT,
        expect.objectContaining({
          webhookId: delivery.webhook.id,
          deliveryId: delivery.id,
          userId: delivery.webhook.userId,
          attempts: WEBHOOK_MAX_ATTEMPTS,
          consecutiveFailures: 10,
          disabled: true,
          error: 'connection refused',
        }),
      );
      expect(notificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: delivery.webhook.userId,
          type: 'WEBHOOK_PERMANENTLY_FAILED',
          title: 'Webhook Delivery Permanently Failed',
          channel: NotificationChannel.IN_APP,
          metadata: expect.objectContaining({
            webhookId: delivery.webhook.id,
            deliveryId: delivery.id,
            disabled: true,
            error: 'connection refused',
          }),
        }),
      );
    });

    it('does not disable the webhook before the consecutive failure threshold', async () => {
      const delivery = makeDelivery({
        webhook: makeWebhook({ consecutiveFailures: 3 }),
      });
      deliveryRepo.findOne.mockResolvedValue(delivery);
      webhookRepo.findOne.mockResolvedValue(
        makeWebhook({ consecutiveFailures: 4 }),
      );
      mockedAxios.post.mockRejectedValue(makeAxiosError('timeout'));

      await expect(
        service.deliverQueuedDelivery(delivery.id, WEBHOOK_MAX_ATTEMPTS, true),
      ).rejects.toThrow('timeout');

      expect(webhookRepo.update).not.toHaveBeenCalledWith(delivery.webhook.id, {
        active: false,
      });
      expect(notificationService.send).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            consecutiveFailures: 4,
            disabled: false,
          }),
        }),
      );
    });
  });

  describe('reconciliation retry', () => {
    it('uses the same final failure handling when an in-place retry exhausts attempts', async () => {
      const delivery = makeDelivery({
        attempts: WEBHOOK_MAX_ATTEMPTS - 1,
        webhook: makeWebhook({ consecutiveFailures: 9 }),
      });
      webhookRepo.findOne.mockResolvedValue(
        makeWebhook({ consecutiveFailures: 10 }),
      );
      mockedAxios.post.mockRejectedValue(makeAxiosError('still offline'));

      await expect(service.retryInPlace(delivery)).resolves.toBe(false);

      expect(delivery.attempts).toBe(WEBHOOK_MAX_ATTEMPTS);
      expect(delivery.status).toBe('permanently_failed');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WEBHOOK_PERMANENTLY_FAILED_EVENT,
        expect.objectContaining({
          deliveryId: delivery.id,
          disabled: true,
        }),
      );
    });
  });
});

function makeWebhook(overrides: Partial<Webhook> = {}): Webhook {
  return {
    id: 'webhook-1',
    userId: 'user-1',
    url: 'https://example.com/webhook',
    events: ['trade.executed'],
    secret: 'secret-1',
    active: true,
    consecutiveFailures: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deliveries: [],
    ...overrides,
  } as Webhook;
}

function makePayload() {
  return {
    event: 'trade.executed' as const,
    timestamp: '2026-01-01T00:00:00.000Z',
    deliveryId: 'event-1',
    data: { tradeId: 'trade-1' },
  };
}

function makeDelivery(
  overrides: Partial<WebhookDelivery> = {},
): WebhookDelivery {
  const webhook = overrides.webhook ?? makeWebhook();
  const payload = makePayload();

  return {
    id: 'delivery-1',
    webhookId: webhook.id,
    webhook,
    eventType: payload.event,
    eventId: payload.deliveryId,
    payload,
    status: 'pending',
    attempts: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as WebhookDelivery;
}

function makeAxiosError(
  message: string,
  status?: number,
  data?: unknown,
): AxiosError {
  return Object.assign(new Error(message), {
    name: 'AxiosError',
    isAxiosError: true,
    toJSON: () => ({}),
    response:
      status === undefined
        ? undefined
        : ({
            status,
            data,
          } as AxiosError['response']),
  }) as AxiosError;
}
