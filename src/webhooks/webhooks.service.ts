import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Webhook, SUPPORTED_WEBHOOK_EVENTS } from './entities/webhook.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import {
  RegisterWebhookDto,
  UpdateWebhookDto,
} from './dto/register-webhook.dto';
import { WebhookPayload } from './dto/webhook-event.dto';
import { SignatureGeneratorService } from './services/signature-generator.service';
import { WebhookSenderService } from './services/webhook-sender.service';
import { SsrfValidationPipe } from './pipes/ssrf-validation.pipe';

const DEFAULT_MAX_DELIVERY_ATTEMPTS = 5;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
const DEFAULT_RETRY_MAX_DELAY_MS = 60000;

export interface DeadLetterEntry {
  deliveryId: string;
  webhookId: string;
  event: string;
  attempts: number;
  lastError: string;
  deadLetteredAt: string;
  payload: WebhookPayload;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  private readonly ssrfPipe = new SsrfValidationPipe();

  private readonly maxDeliveryAttempts =
    Number(process.env.WEBHOOK_MAX_ATTEMPTS) || DEFAULT_MAX_DELIVERY_ATTEMPTS;

  private readonly retryBaseDelayMs =
    Number(process.env.WEBHOOK_RETRY_BASE_DELAY_MS) ||
    DEFAULT_RETRY_BASE_DELAY_MS;

  private readonly retryMaxDelayMs =
    Number(process.env.WEBHOOK_RETRY_MAX_DELAY_MS) ||
    DEFAULT_RETRY_MAX_DELAY_MS;

  private readonly deadLetterQueue: DeadLetterEntry[] = [];

  constructor(
    @InjectRepository(Webhook)
    private readonly webhookRepo: Repository<Webhook>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    private readonly signatureGenerator: SignatureGeneratorService,
    private readonly webhookSender: WebhookSenderService,
  ) {}

  async register(userId: string, dto: RegisterWebhookDto): Promise<Webhook> {
    this.validateEvents(dto.events as string[]);
    await this.ssrfPipe.transform(dto.url);

    const secret = this.signatureGenerator.generateSecret();

    const webhook = this.webhookRepo.create({
      userId,
      url: dto.url,
      events: dto.events as string[],
      secret,
      active: true,
      consecutiveFailures: 0,
      description: dto.description,
    });

    return this.webhookRepo.save(webhook);
  }

  async findAllForUser(userId: string): Promise<Webhook[]> {
    return this.webhookRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(userId: string, id: string): Promise<Webhook> {
    const webhook = await this.webhookRepo.findOne({ where: { id } });
    if (!webhook) throw new NotFoundException(`Webhook not found: ${id}`);
    if (webhook.userId !== userId) throw new ForbiddenException();
    return webhook;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateWebhookDto,
  ): Promise<Webhook> {
    const webhook = await this.findOne(userId, id);

    if (dto.events) {
      this.validateEvents(dto.events as string[]);
    }

    if (dto.url !== undefined) {
      await this.ssrfPipe.transform(dto.url);
      webhook.url = dto.url;
    }
    if (dto.events !== undefined) webhook.events = dto.events as string[];
    if (dto.active !== undefined) {
      webhook.active = dto.active;
      if (dto.active) webhook.consecutiveFailures = 0;
    }
    if (dto.description !== undefined) webhook.description = dto.description;

    return this.webhookRepo.save(webhook);
  }

  async remove(userId: string, id: string): Promise<void> {
    const webhook = await this.findOne(userId, id);
    await this.webhookRepo.remove(webhook);
  }

  async getDeliveries(
    userId: string,
    webhookId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ deliveries: WebhookDelivery[]; total: number }> {
    await this.findOne(userId, webhookId);

    const [deliveries, total] = await this.deliveryRepo.findAndCount({
      where: { webhookId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    return { deliveries, total };
  }

  async retryDelivery(userId: string, deliveryId: string): Promise<void> {
    const delivery = await this.deliveryRepo.findOne({
      where: { id: deliveryId },
      relations: ['webhook'],
    });

    if (!delivery)
      throw new NotFoundException(`Delivery not found: ${deliveryId}`);
    if (delivery.webhook.userId !== userId) throw new ForbiddenException();

    await this.webhookSender.retryDelivery(deliveryId);
  }

  async replayToSubscriber(
    userId: string,
    deliveryId: string,
    subscriberWebhookId: string,
  ): Promise<void> {
    const delivery = await this.deliveryRepo.findOne({
      where: { id: deliveryId },
    });
    if (!delivery)
      throw new NotFoundException(`Delivery not found: ${deliveryId}`);

    const webhook = await this.findOne(userId, subscriberWebhookId);

    const replayPayload = {
      ...(delivery.payload as any),
      deliveryId: uuidv4(),
      isReplay: true,
      originalDeliveryId: deliveryId,
    };

    await this.webhookSender.deliverWebhook(webhook, replayPayload);
  }

  async dispatchEvent(
    eventName: string,
    eventData: Record<string, unknown>,
  ): Promise<void> {
    const webhooks = await this.webhookRepo
      .createQueryBuilder('w')
      .where('w.active = true')
      .andWhere(":event = ANY(string_to_array(w.events, ','))", {
        event: eventName,
      })
      .getMany();

    if (webhooks.length === 0) return;

    this.logger.log(
      `Dispatching event "${eventName}" to ${webhooks.length} webhook(s)`,
    );

    const payload: WebhookPayload = {
      event: eventName as WebhookPayload['event'],
      timestamp: new Date().toISOString(),
      deliveryId: uuidv4(),
      data: eventData,
    };

    await Promise.allSettled(
      webhooks.map((webhook) =>
        this.deliverWithRetry(webhook, {
          ...payload,
          deliveryId: uuidv4(),
        }),
      ),
    );
  }

  /**
   * Delivers a webhook with exponential backoff retries. When all attempts are
   * exhausted the delivery is moved to the dead-letter queue so downstream
   * integrations can be inspected and replayed.
   */
  async deliverWithRetry(
    webhook: Webhook,
    payload: WebhookPayload,
  ): Promise<void> {
    let lastError = 'Unknown delivery error';

    for (let attempt = 1; attempt <= this.maxDeliveryAttempts; attempt++) {
      try {
        await this.webhookSender.deliverWebhook(webhook, payload);
        if (attempt > 1) {
          this.logger.log(
            `Webhook ${webhook.id} delivery ${payload.deliveryId} succeeded on attempt ${attempt}`,
          );
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);

        if (attempt >= this.maxDeliveryAttempts) break;

        const delay = this.computeBackoffDelay(attempt);
        this.logger.warn(
          `Webhook ${webhook.id} delivery ${payload.deliveryId} failed on attempt ${attempt}/${this.maxDeliveryAttempts}: ${lastError}. Retrying in ${delay}ms`,
        );
        await this.sleep(delay);
      }
    }

    this.moveToDeadLetter(webhook, payload, lastError);
  }

  getDeadLetterQueue(): DeadLetterEntry[] {
    return [...this.deadLetterQueue];
  }

  private moveToDeadLetter(
    webhook: Webhook,
    payload: WebhookPayload,
    lastError: string,
  ): void {
    const entry: DeadLetterEntry = {
      deliveryId: payload.deliveryId,
      webhookId: webhook.id,
      event: payload.event,
      attempts: this.maxDeliveryAttempts,
      lastError,
      deadLetteredAt: new Date().toISOString(),
      payload,
    };

    this.deadLetterQueue.push(entry);

    this.logger.error(
      `Webhook ${webhook.id} delivery ${payload.deliveryId} exhausted ${this.maxDeliveryAttempts} attempt(s) and was moved to the dead-letter queue: ${lastError}`,
    );
  }

  private computeBackoffDelay(attempt: number): number {
    const exponential = this.retryBaseDelayMs * Math.pow(2, attempt - 1);
    return Math.min(exponential, this.retryMaxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async initiateSecretRotation(
    userId: string,
    webhookId: string,
    rotationWindowMs: number = 3600000,
  ): Promise<Webhook> {
    const webhook = await this.findOne(userId, webhookId);

    webhook.nextSecret = this.signatureGenerator.generateSecret();
    webhook.rotationStartedAt = new Date();
    webhook.rotationFinalizesAt = new Date(Date.now() + rotationWindowMs);

    this.logger.log(
      `Initiated secret rotation for webhook ${webhookId}, window: ${rotationWindowMs}ms`,
    );
    return this.webhookRepo.save(webhook);
  }

  async finalizeSecretRotation(
    userId: string,
    webhookId: string,
  ): Promise<Webhook> {
    const webhook = await this.findOne(userId, webhookId);

    if (!webhook.nextSecret) {
      throw new BadRequestException('No rotation in progress for this webhook');
    }

    webhook.secret = webhook.nextSecret;
    webhook.nextSecret = undefined;
    webhook.rotationStartedAt = undefined;
    webhook.rotationFinalizesAt = undefined;

    this.logger.log(`Finalized secret rotation for webhook ${webhookId}`);
    return this.webhookRepo.save(webhook);
  }

  private validateEvents(events: string[]): void {
    const invalid = events.filter(
      (e) => !(SUPPORTED_WEBHOOK_EVENTS as readonly string[]).includes(e),
    );
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Unsupported event type(s): ${invalid.join(', ')}. Supported: ${SUPPORTED_WEBHOOK_EVENTS.join(', ')}`,
      );
    }
  }
}
