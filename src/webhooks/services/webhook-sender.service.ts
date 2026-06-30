import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosError } from 'axios';
import { Webhook } from '../entities/webhook.entity';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { WebhookPayload } from '../dto/webhook-event.dto';
import { SignatureGeneratorService } from './signature-generator.service';

const MAX_ATTEMPTS = 3;
const MAX_CONSECUTIVE_FAILURES = 10;
const REQUEST_TIMEOUT_MS = 5000;

@Injectable()
export class WebhookSenderService {
  private readonly logger = new Logger(WebhookSenderService.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(Webhook)
    private readonly webhookRepo: Repository<Webhook>,
    private readonly signatureGenerator: SignatureGeneratorService,
  ) {}

  async deliverWebhook(webhook: Webhook, payload: WebhookPayload): Promise<void> {
    const signature = this.signatureGenerator.generateSignature(payload, webhook.secret);

    const delivery = this.deliveryRepo.create({
      webhookId: webhook.id,
      eventType: payload.event,
      eventId: payload.deliveryId,
      payload: payload as unknown as Record<string, unknown>,
      status: 'pending',
      attempts: 0,
    });
    await this.deliveryRepo.save(delivery);

    let attempt = 0;

    while (attempt < MAX_ATTEMPTS) {
      try {
        delivery.attempts = attempt + 1;

        const response = await axios.post(webhook.url, payload, {
          headers: {
            'Content-Type': 'application/json',
            'X-StellarSwipe-Signature': `sha256=${signature}`,
            'X-StellarSwipe-Event': payload.event,
            'X-StellarSwipe-Delivery-Id': payload.deliveryId,
          },
          timeout: REQUEST_TIMEOUT_MS,
        });

        delivery.status = 'success';
        delivery.responseStatus = response.status;
        delivery.responseBody = JSON.stringify(response.data).slice(0, 1000);
        delivery.deliveredAt = new Date();
        delivery.errorMessage = undefined;
        await this.deliveryRepo.save(delivery);

        await this.webhookRepo.update(webhook.id, { consecutiveFailures: 0 });

        this.logger.log(
          `Webhook delivered: webhook=${webhook.id} event=${payload.event} attempt=${delivery.attempts}`,
        );
        return;
      } catch (err) {
        attempt++;
        const error = err as AxiosError;

        delivery.responseStatus = error.response?.status;
        delivery.responseBody = error.response
          ? JSON.stringify(error.response.data).slice(0, 1000)
          : undefined;
        delivery.errorMessage = error.message;

        this.logger.warn(
          `Webhook delivery attempt ${attempt}/${MAX_ATTEMPTS} failed: webhook=${webhook.id} event=${payload.event} error=${error.message}`,
        );

        if (attempt < MAX_ATTEMPTS) {
          const delayMs = Math.pow(2, attempt) * 1000;
          delivery.nextRetryAt = new Date(Date.now() + delayMs);
          await this.deliveryRepo.save(delivery);
          await this.delay(delayMs);
        }
      }
    }

    delivery.status = 'failed';
    delivery.nextRetryAt = undefined;
    await this.deliveryRepo.save(delivery);

    await this.incrementConsecutiveFailures(webhook);
  }

  async retryDelivery(deliveryId: string): Promise<void> {
    const delivery = await this.deliveryRepo.findOne({
      where: { id: deliveryId },
      relations: ['webhook'],
    });

    if (!delivery) {
      throw new Error(`Delivery not found: ${deliveryId}`);
    }

    if (!delivery.webhook.active) {
      throw new Error('Cannot retry delivery for an inactive webhook');
    }

    await this.deliverWebhook(delivery.webhook, delivery.payload as unknown as WebhookPayload);
  }

  private async incrementConsecutiveFailures(webhook: Webhook): Promise<void> {
    const updated = await this.webhookRepo.increment(
      { id: webhook.id },
      'consecutiveFailures',
      1,
    );

    const fresh = await this.webhookRepo.findOne({ where: { id: webhook.id } });
    if (fresh && fresh.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      await this.webhookRepo.update(webhook.id, { active: false });
      this.logger.warn(
        `Webhook disabled after ${MAX_CONSECUTIVE_FAILURES} consecutive failures: ${webhook.id} url=${webhook.url}`,
      );
    }

    return updated as unknown as void;
  }

  /**
   * Performs a single HTTP delivery attempt on an EXISTING delivery record,
   * updating it in-place. Used by the reconciliation job to avoid creating
   * duplicate delivery records.
   *
   * Returns true if delivery succeeded, false otherwise.
   */
  async retryInPlace(delivery: WebhookDelivery): Promise<boolean> {
    const webhook = delivery.webhook;
    if (!webhook?.active) {
      this.logger.warn(
        `Skipping reconciliation retry — webhook inactive: delivery=${delivery.id} webhookId=${delivery.webhookId}`,
      );
      return false;
    }

    const payload = delivery.payload as unknown as WebhookPayload;
    const signature = this.signatureGenerator.generateSignature(payload, webhook.secret);

    delivery.attempts += 1;

    try {
      const response = await axios.post(webhook.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-StellarSwipe-Signature': `sha256=${signature}`,
          'X-StellarSwipe-Event': payload.event,
          'X-StellarSwipe-Delivery-Id': payload.deliveryId,
        },
        timeout: REQUEST_TIMEOUT_MS,
      });

      delivery.status = 'success';
      delivery.responseStatus = response.status;
      delivery.responseBody = JSON.stringify(response.data).slice(0, 1000);
      delivery.deliveredAt = new Date();
      delivery.nextRetryAt = undefined;
      delivery.errorMessage = undefined;
      await this.deliveryRepo.save(delivery);

      await this.webhookRepo.update(webhook.id, { consecutiveFailures: 0 });

      this.logger.log(
        `Reconciliation delivery succeeded: delivery=${delivery.id} event=${payload.event} attempt=${delivery.attempts}`,
      );
      return true;
    } catch (err) {
      const error = err as AxiosError;
      const backoffMs = Math.pow(2, delivery.attempts) * 1000;

      delivery.responseStatus = error.response?.status;
      delivery.responseBody = error.response
        ? JSON.stringify(error.response.data).slice(0, 1000)
        : undefined;
      delivery.errorMessage = error.message;
      delivery.nextRetryAt = new Date(Date.now() + backoffMs);
      await this.deliveryRepo.save(delivery);

      this.logger.warn(
        `Reconciliation delivery attempt ${delivery.attempts} failed: delivery=${delivery.id} event=${payload.event} error=${error.message} nextRetry=${delivery.nextRetryAt.toISOString()}`,
      );
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
