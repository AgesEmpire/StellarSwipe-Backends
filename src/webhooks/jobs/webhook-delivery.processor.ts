import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WebhookSenderService } from '../services/webhook-sender.service';
import {
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_QUEUE,
  WEBHOOK_MAX_ATTEMPTS,
  WebhookDeliveryJobData,
  webhookDeliveryBackoffStrategy,
} from './webhook-delivery.constants';

@Processor(WEBHOOK_DELIVERY_QUEUE, {
  settings: {
    backoffStrategy: webhookDeliveryBackoffStrategy,
  },
})
export class WebhookDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookDeliveryProcessor.name);

  constructor(private readonly webhookSender: WebhookSenderService) {
    super();
  }

  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    if (job.name !== WEBHOOK_DELIVERY_JOB) {
      this.logger.debug(
        `Skipping unsupported webhook delivery job: ${job.name}`,
      );
      return;
    }

    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? WEBHOOK_MAX_ATTEMPTS;
    const isFinalAttempt = attempt >= maxAttempts;

    await this.webhookSender.deliverQueuedDelivery(
      job.data.deliveryId,
      attempt,
      isFinalAttempt,
    );
  }
}
