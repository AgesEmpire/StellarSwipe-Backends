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
import { RegisterWebhookDto, UpdateWebhookDto } from './dto/register-webhook.dto';
import { WebhookPayload } from './dto/webhook-event.dto';
import { SignatureGeneratorService } from './services/signature-generator.service';
import { WebhookSenderService } from './services/webhook-sender.service';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

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

  async update(userId: string, id: string, dto: UpdateWebhookDto): Promise<Webhook> {
    const webhook = await this.findOne(userId, id);

    if (dto.events) {
      this.validateEvents(dto.events as string[]);
    }

    if (dto.url !== undefined) webhook.url = dto.url;
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

    if (!delivery) throw new NotFoundException(`Delivery not found: ${deliveryId}`);
    if (delivery.webhook.userId !== userId) throw new ForbiddenException();

    await this.webhookSender.retryDelivery(deliveryId);
  }

  async dispatchEvent(
    eventName: string,
    eventData: Record<string, unknown>,
  ): Promise<void> {
    const webhooks = await this.webhookRepo
      .createQueryBuilder('w')
      .where('w.active = true')
      .andWhere(':event = ANY(string_to_array(w.events, \',\'))', { event: eventName })
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
        this.webhookSender.deliverWebhook(webhook, { ...payload, deliveryId: uuidv4() }),
      ),
    );
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
