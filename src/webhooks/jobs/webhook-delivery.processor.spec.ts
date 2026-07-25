jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { Job } from 'bullmq';
import { WebhookSenderService } from '../services/webhook-sender.service';
import {
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_MAX_ATTEMPTS,
  WebhookDeliveryJobData,
} from './webhook-delivery.constants';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';

describe('WebhookDeliveryProcessor', () => {
  let processor: WebhookDeliveryProcessor;
  let webhookSender: {
    deliverQueuedDelivery: jest.Mock;
  };

  beforeEach(() => {
    webhookSender = {
      deliverQueuedDelivery: jest.fn().mockResolvedValue(undefined),
    };
    processor = new WebhookDeliveryProcessor(
      webhookSender as unknown as WebhookSenderService,
    );
    jest
      .spyOn((processor as any).logger, 'debug')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('processes the first BullMQ attempt as attempt 1', async () => {
    await processor.process(makeJob({ attemptsMade: 0 }));

    expect(webhookSender.deliverQueuedDelivery).toHaveBeenCalledWith(
      'delivery-1',
      1,
      false,
    );
  });

  it('marks the eighth attempt as the final delivery attempt', async () => {
    await processor.process(
      makeJob({
        attemptsMade: WEBHOOK_MAX_ATTEMPTS - 1,
        attempts: WEBHOOK_MAX_ATTEMPTS,
      }),
    );

    expect(webhookSender.deliverQueuedDelivery).toHaveBeenCalledWith(
      'delivery-1',
      WEBHOOK_MAX_ATTEMPTS,
      true,
    );
  });

  it('honors a custom attempts value from the BullMQ job options', async () => {
    await processor.process(
      makeJob({
        attemptsMade: 2,
        attempts: 3,
      }),
    );

    expect(webhookSender.deliverQueuedDelivery).toHaveBeenCalledWith(
      'delivery-1',
      3,
      true,
    );
  });

  it('skips unsupported job names without calling the sender', async () => {
    await processor.process(
      makeJob({
        name: 'unsupported-job',
      }),
    );

    expect(webhookSender.deliverQueuedDelivery).not.toHaveBeenCalled();
  });
});

function makeJob(
  overrides: {
    name?: string;
    deliveryId?: string;
    attemptsMade?: number;
    attempts?: number;
  } = {},
): Job<WebhookDeliveryJobData> {
  return {
    id: 'job-1',
    name: overrides.name ?? WEBHOOK_DELIVERY_JOB,
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: {
      attempts: overrides.attempts ?? WEBHOOK_MAX_ATTEMPTS,
    },
    data: {
      deliveryId: overrides.deliveryId ?? 'delivery-1',
      manualRetry: false,
    },
  } as Job<WebhookDeliveryJobData>;
}
