import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Repository } from 'typeorm';
import { Queue } from 'bullmq';
import axios, { AxiosError } from 'axios';
import { NotificationChannel } from '../../notifications/entities/notification.entity';
import { NotificationService } from '../../notifications/notification.service';
import { Webhook } from '../entities/webhook.entity';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { WebhookPayload } from '../dto/webhook-event.dto';
import { SignatureGeneratorService } from './signature-generator.service';
import {
  WEBHOOK_DELIVERY_JOB,
  WEBHOOK_DELIVERY_JOB_OPTIONS,
  WEBHOOK_DELIVERY_QUEUE,
  WEBHOOK_FAILURE_DISABLE_THRESHOLD,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_PERMANENTLY_FAILED_EVENT,
  WEBHOOK_REQUEST_TIMEOUT_MS,
  WebhookDeliveryJobData,
  calculateWebhookBackoffDelay,
} from '../jobs/webhook-delivery.constants';

@Injectable()
export class WebhookSenderService {
  private readonly logger = new Logger(WebhookSenderService.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(Webhook)
    private readonly webhookRepo: Repository<Webhook>,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE)
    private readonly deliveryQueue: Queue<WebhookDeliveryJobData>,
    private readonly signatureGenerator: SignatureGeneratorService,
    private readonly eventEmitter: EventEmitter2,
    private readonly notificationService: NotificationService,
  ) {}

  async deliverWebhook(
    webhook: Webhook,
    payload: WebhookPayload,
  ): Promise<void> {
    const delivery = this.deliveryRepo.create({
      webhookId: webhook.id,
      eventType: payload.event,
      eventId: payload.deliveryId,
      payload: payload as unknown as Record<string, unknown>,
      status: 'pending',
      attempts: 0,
    });
    const saved = await this.deliveryRepo.save(delivery);

    await this.enqueueDelivery(saved.id, false);
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

    delivery.status = 'pending';
    delivery.nextRetryAt = undefined;
    delivery.errorMessage = undefined;
    await this.deliveryRepo.save(delivery);

    await this.enqueueDelivery(delivery.id, true);
  }

  async deliverQueuedDelivery(
    deliveryId: string,
    attempt: number,
    isFinalAttempt = false,
  ): Promise<void> {
    const delivery = await this.getDeliveryForAttempt(deliveryId);
    const webhook = delivery.webhook;
    const payload = delivery.payload as unknown as WebhookPayload;
    const signature = this.signatureGenerator.generateSignature(
      payload,
      webhook.secret,
    );

    delivery.attempts = attempt;

    try {
      const response = await axios.post(webhook.url, payload, {
        headers: this.buildHeaders(payload, signature),
        timeout: WEBHOOK_REQUEST_TIMEOUT_MS,
      });

      await this.recordDeliverySuccess(
        delivery,
        response.status,
        response.data,
      );
    } catch (err) {
      await this.recordDeliveryFailure(
        delivery,
        err as AxiosError,
        attempt,
        isFinalAttempt,
      );
      throw err;
    }
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
        `Skipping reconciliation retry: webhook inactive: delivery=${delivery.id} webhookId=${delivery.webhookId}`,
      );
      return false;
    }

    const payload = delivery.payload as unknown as WebhookPayload;
    const signature = this.signatureGenerator.generateSignature(
      payload,
      webhook.secret,
    );

    delivery.attempts += 1;

    try {
      const response = await axios.post(webhook.url, payload, {
        headers: this.buildHeaders(payload, signature),
        timeout: WEBHOOK_REQUEST_TIMEOUT_MS,
      });

      await this.recordDeliverySuccess(
        delivery,
        response.status,
        response.data,
      );

      this.logger.log(
        `Reconciliation delivery succeeded: delivery=${delivery.id} event=${payload.event} attempt=${delivery.attempts}`,
      );
      return true;
    } catch (err) {
      const isFinalAttempt = delivery.attempts >= WEBHOOK_MAX_ATTEMPTS;
      await this.recordDeliveryFailure(
        delivery,
        err as AxiosError,
        delivery.attempts,
        isFinalAttempt,
      );

      this.logger.warn(
        `Reconciliation delivery attempt ${delivery.attempts} failed: delivery=${delivery.id} event=${payload.event} error=${(err as Error).message}`,
      );
      return false;
    }
  }

  private async enqueueDelivery(
    deliveryId: string,
    manualRetry: boolean,
  ): Promise<void> {
    await this.deliveryQueue.add(
      WEBHOOK_DELIVERY_JOB,
      { deliveryId, manualRetry },
      WEBHOOK_DELIVERY_JOB_OPTIONS,
    );
  }

  private async getDeliveryForAttempt(
    deliveryId: string,
  ): Promise<WebhookDelivery> {
    const delivery = await this.deliveryRepo.findOne({
      where: { id: deliveryId },
      relations: ['webhook'],
    });

    if (!delivery) {
      throw new Error(`Delivery not found: ${deliveryId}`);
    }

    if (!delivery.webhook?.active) {
      throw new Error('Cannot deliver webhook for an inactive registration');
    }

    return delivery;
  }

  private async recordDeliverySuccess(
    delivery: WebhookDelivery,
    responseStatus: number,
    responseData: unknown,
  ): Promise<void> {
    delivery.status = 'success';
    delivery.responseStatus = responseStatus;
    delivery.responseBody = this.serializeResponseBody(responseData);
    delivery.deliveredAt = new Date();
    delivery.nextRetryAt = undefined;
    delivery.errorMessage = undefined;
    await this.deliveryRepo.save(delivery);

    await this.webhookRepo.update(delivery.webhook.id, {
      consecutiveFailures: 0,
    });

    this.logger.log(
      `Webhook delivered: webhook=${delivery.webhook.id} event=${delivery.eventType} attempt=${delivery.attempts}`,
    );
  }

  private async recordDeliveryFailure(
    delivery: WebhookDelivery,
    error: AxiosError,
    attempt: number,
    isFinalAttempt: boolean,
  ): Promise<void> {
    delivery.attempts = attempt;
    delivery.responseStatus = error.response?.status;
    delivery.responseBody = error.response
      ? this.serializeResponseBody(error.response.data)
      : undefined;
    delivery.errorMessage = error.message;

    if (isFinalAttempt) {
      delivery.status = 'permanently_failed';
      delivery.nextRetryAt = undefined;
      await this.deliveryRepo.save(delivery);
      await this.handlePermanentFailure(delivery, error);
      return;
    }

    const delayMs = calculateWebhookBackoffDelay(attempt);
    delivery.status = 'failed';
    delivery.nextRetryAt = new Date(Date.now() + delayMs);
    await this.deliveryRepo.save(delivery);

    this.logger.warn(
      `Webhook delivery attempt ${attempt}/${WEBHOOK_MAX_ATTEMPTS} failed: webhook=${delivery.webhook.id} event=${delivery.eventType} error=${error.message} nextRetry=${delivery.nextRetryAt.toISOString()}`,
    );
  }

  private async handlePermanentFailure(
    delivery: WebhookDelivery,
    error: AxiosError,
  ): Promise<void> {
    const failureState = await this.incrementConsecutiveFailures(
      delivery.webhook,
    );
    const event = {
      webhookId: delivery.webhook.id,
      deliveryId: delivery.id,
      userId: delivery.webhook.userId,
      url: delivery.webhook.url,
      eventType: delivery.eventType,
      eventId: delivery.eventId,
      attempts: delivery.attempts,
      consecutiveFailures: failureState.consecutiveFailures,
      disabled: failureState.disabled,
      error: error.message,
      occurredAt: new Date(),
    };

    this.eventEmitter.emit(WEBHOOK_PERMANENTLY_FAILED_EVENT, event);
    await this.notifyPermanentFailure(event);

    this.logger.error(
      `Webhook permanently failed: webhook=${delivery.webhook.id} delivery=${delivery.id} attempts=${delivery.attempts} error=${error.message}`,
    );
  }

  private async incrementConsecutiveFailures(
    webhook: Webhook,
  ): Promise<{ consecutiveFailures: number; disabled: boolean }> {
    await this.webhookRepo.increment(
      { id: webhook.id },
      'consecutiveFailures',
      1,
    );

    const fresh = await this.webhookRepo.findOne({ where: { id: webhook.id } });
    const consecutiveFailures =
      fresh?.consecutiveFailures ?? webhook.consecutiveFailures + 1;
    const disabled = consecutiveFailures >= WEBHOOK_FAILURE_DISABLE_THRESHOLD;

    if (disabled) {
      await this.webhookRepo.update(webhook.id, { active: false });
      this.logger.warn(
        `Webhook disabled after ${WEBHOOK_FAILURE_DISABLE_THRESHOLD} consecutive failures: ${webhook.id} url=${webhook.url}`,
      );
    }

    return { consecutiveFailures, disabled };
  }

  private async notifyPermanentFailure(event: {
    userId: string;
    webhookId: string;
    deliveryId: string;
    url: string;
    eventType: string;
    eventId: string;
    attempts: number;
    consecutiveFailures: number;
    disabled: boolean;
    error: string;
  }): Promise<void> {
    try {
      await this.notificationService.send({
        userId: event.userId,
        type: 'WEBHOOK_PERMANENTLY_FAILED',
        title: 'Webhook Delivery Permanently Failed',
        message: `Webhook delivery to ${event.url} failed permanently after ${event.attempts} attempts.`,
        channel: NotificationChannel.IN_APP,
        metadata: {
          webhookId: event.webhookId,
          deliveryId: event.deliveryId,
          eventType: event.eventType,
          eventId: event.eventId,
          consecutiveFailures: event.consecutiveFailures,
          disabled: event.disabled,
          error: event.error,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify webhook owner ${event.userId} for delivery ${event.deliveryId}: ${(err as Error).message}`,
      );
    }
  }

  private buildHeaders(
    payload: WebhookPayload,
    signature: string,
  ): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-StellarSwipe-Signature': `sha256=${signature}`,
      'X-StellarSwipe-Event': payload.event,
      'X-StellarSwipe-Delivery-Id': payload.deliveryId,
    };
  }

  private serializeResponseBody(data: unknown): string | undefined {
    if (data === undefined) return undefined;

    try {
      return JSON.stringify(data).slice(0, 1000);
    } catch {
      return String(data).slice(0, 1000);
    }
  }
}
