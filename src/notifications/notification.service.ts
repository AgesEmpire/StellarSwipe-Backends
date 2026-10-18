import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import {
  Notification,
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  resolveNotificationPriority,
} from './entities/notification.entity';
import { SendNotificationDto } from './dto/send-notification.dto';
import { PreferencesService } from './preferences/preferences.service';
import { ConsentService } from './consent.service';
import { ConsentCategory } from './entities/user-consent.entity';

export const NOTIFICATION_QUEUE = 'notifications';

interface NotificationTemplate {
  body: string;
  requiredVariables: string[];
}

export const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  TRADE_EXECUTED: { body: 'Your trade {{symbol}} was executed at {{price}}.', requiredVariables: ['symbol', 'price'] },
  TRADE_PENDING: { body: 'Your trade {{symbol}} is pending.', requiredVariables: ['symbol'] },
  TRADE_CANCELLED: { body: 'Your trade {{symbol}} was cancelled.', requiredVariables: ['symbol'] },
  TRADE_FAILED: { body: 'Your trade {{symbol}} failed: {{reason}}.', requiredVariables: ['symbol', 'reason'] },
  SIGNAL_CREATED: { body: 'New signal for {{symbol}}.', requiredVariables: ['symbol'] },
  SIGNAL_UPDATED: { body: 'Signal for {{symbol}} was updated.', requiredVariables: ['symbol'] },
  SIGNAL_CLOSED: { body: 'Signal for {{symbol}} was closed.', requiredVariables: ['symbol'] },
  RISK_ALERT: { body: 'Risk alert: {{message}}.', requiredVariables: ['message'] },
  PRICE_ALERT: { body: 'Price alert for {{symbol}} at {{price}}.', requiredVariables: ['symbol', 'price'] },
};

const TEMPLATE_VARIABLE_PATTERN = /{{\s*([\w.]+)\s*}}/g;

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    private readonly preferencesService: PreferencesService,
    private readonly consentService: ConsentService,
  ) {}

  onModuleInit(): void {
    const errors = this.validateTemplates();
    if (errors.length > 0) {
      throw new Error(`Invalid notification templates:\n${errors.join('\n')}`);
    }
    this.logger.log(`Validated ${Object.keys(NOTIFICATION_TEMPLATES).length} notification templates`);
  }

  validateTemplates(): string[] {
    const errors: string[] = [];
    for (const [type, template] of Object.entries(NOTIFICATION_TEMPLATES)) {
      const placeholders = new Set<string>();
      let match: RegExpExecArray | null;
      TEMPLATE_VARIABLE_PATTERN.lastIndex = 0;
      while ((match = TEMPLATE_VARIABLE_PATTERN.exec(template.body)) !== null) {
        placeholders.add(match[1]);
      }
      if (placeholders.size === 0) {
        errors.push(`Template "${type}" contains no variables; expected at least one placeholder.`);
      }
      for (const variable of template.requiredVariables) {
        if (!placeholders.has(variable)) {
          errors.push(`Template "${type}" declares required variable "${variable}" but does not reference it as {{${variable}}}.`);
        }
      }
      for (const placeholder of placeholders) {
        if (!template.requiredVariables.includes(placeholder)) {
          errors.push(`Template "${type}" references undeclared variable "${placeholder}"; add it to requiredVariables.`);
        }
      }
    }
    return errors;
  }

  renderTemplate(type: string, variables: Record<string, string>): string {
    const template = NOTIFICATION_TEMPLATES[type];
    if (!template) {
      throw new NotFoundException(`No notification template registered for type ${type}`);
    }
    const missing = template.requiredVariables.filter((variable) => variables[variable] === undefined);
    if (missing.length > 0) {
      throw new Error(`Missing required variables for template "${type}": ${missing.join(', ')}`);
    }
    return template.body.replace(TEMPLATE_VARIABLE_PATTERN, (_match, name: string) => variables[name] ?? '');
  }

  /**
   * Send a notification at most once for a given dedupe key.
   *
   * Idempotency is persisted in the notification's metadata so duplicate
   * lifecycle events (e.g. a repeated renewal webhook) do not deliver the
   * same notification twice.
   */
  async sendOnce(dedupeKey: string, dto: SendNotificationDto): Promise<Notification> {
    const existing = await this.notificationRepository
      .createQueryBuilder('notification')
      .where('notification.userId = :userId', { userId: dto.userId })
      .andWhere("notification.metadata ->> 'dedupeKey' = :dedupeKey", { dedupeKey })
      .getOne();

    if (existing) {
      this.logger.debug(
        `Notification with dedupe key "${dedupeKey}" already exists (${existing.id}); skipping`,
      );
      return existing;
    }

    return this.send({
      ...dto,
      metadata: { ...(dto.metadata ?? {}), dedupeKey },
    });
  }

  /**
   * Create (and, unless deferred to a digest, queue for delivery) a
   * notification for a specific domain event, using a stable event
   * identifier to dedupe at the database level.
   *
   * Domain event listeners sometimes retry (queue redelivery, at-least-once
   * event buses, etc.). Rather than tracking "have I seen this event"
   * in process memory — which is lost on restart and doesn't work across
   * multiple instances — the event id is stored on the notification row
   * behind a unique index. A retried call with the same `eventId` is
   * rejected by the database (`ON CONFLICT DO NOTHING`) instead of
   * inserting a second inbox item, and the existing notification is
   * returned so callers can't tell the difference.
   *
   * @param eventId Stable identifier of the domain event, e.g.
   *   `${event.eventName}:${event.tradeId}:${event.correlationId}`.
   * @param dto The notification to create if this event hasn't been seen.
   * @returns The notification (newly created or the pre-existing one) and
   *   whether this call observed a duplicate.
   */
  async sendForEvent(
    eventId: string,
    dto: SendNotificationDto,
  ): Promise<{ notification: Notification; deduplicated: boolean }> {
    const channel = dto.channel ?? NotificationChannel.IN_APP;
    const priority = resolveNotificationPriority(dto.type);

    const insertResult = await this.notificationRepository
      .createQueryBuilder()
      .insert()
      .into(Notification)
      .values({
        userId: dto.userId,
        type: dto.type,
        channel,
        title: dto.title,
        message: dto.message,
        metadata: dto.metadata ?? {},
        status: NotificationStatus.PENDING,
        priority,
        eventId,
      })
      .orIgnore()
      .returning(['id'])
      .execute();

    if (insertResult.raw.length === 0) {
      const existing = await this.notificationRepository.findOne({ where: { eventId } });
      if (existing) {
        this.logger.debug(
          `Duplicate domain event "${eventId}"; reusing existing notification ${existing.id} instead of creating another`,
        );
        return { notification: existing, deduplicated: true };
      }
      // Replication lag / read-after-write edge case: the conflict says a row
      // exists but we couldn't read it back yet. Surface this rather than
      // silently dropping the notification.
      throw new Error(
        `Insert for domain event "${eventId}" was ignored (duplicate) but no existing notification was found`,
      );
    }

    const insertedId: string = insertResult.raw[0].id ?? insertResult.identifiers[0]?.id;
    const notification = await this.notificationRepository.findOneByOrFail({ id: insertedId });

    if (priority === NotificationPriority.LOW && channel === NotificationChannel.IN_APP) {
      // Low-priority in-app notifications are batched into a scheduled
      // digest instead of being queued for immediate delivery.
      return { notification, deduplicated: false };
    }

    await this.notificationQueue.add('deliver', { notificationId: notification.id }, {
      priority: 100,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    return { notification, deduplicated: false };
  }

  async send(dto: SendNotificationDto): Promise<Notification> {
    const channel = dto.channel ?? NotificationChannel.IN_APP;

    if (channel !== NotificationChannel.IN_APP) {
      const consentCategory =
        channel === NotificationChannel.EMAIL
          ? ConsentCategory.MARKETING_EMAIL
          : ConsentCategory.MARKETING_PUSH;
      const typeKey = this.mapTypeToPreference(dto.type);
      if (typeKey === 'marketing') {
        const hasConsent = await this.consentService.hasConsented(dto.userId, consentCategory);
        if (!hasConsent) {
          this.logger.log(
            `Marketing notification suppressed for user ${dto.userId}: no consent for ${consentCategory}`,
          );
          const notification = this.notificationRepository.create({
            ...dto,
            channel: NotificationChannel.IN_APP,
            status: NotificationStatus.SENT,
          });
          return this.notificationRepository.save(notification);
        }
      }
    }

    const channelKey = channel === NotificationChannel.EMAIL ? 'email' : 'push';
    const typeKey = this.mapTypeToPreference(dto.type);
    if (typeKey && channel !== NotificationChannel.IN_APP) {
      const enabled = await this.preferencesService.isEnabled(dto.userId, typeKey, channelKey as any);
      if (!enabled) {
        this.logger.log(`Notification suppressed for user ${dto.userId}: ${typeKey}/${channelKey} disabled`);
        const notification = this.notificationRepository.create({
          ...dto,
          channel: NotificationChannel.IN_APP,
          status: NotificationStatus.SENT,
        });
        return this.notificationRepository.save(notification);
      }
    }

    const priority = resolveNotificationPriority(dto.type);
    const notification = this.notificationRepository.create({
      ...dto,
      channel,
      status: NotificationStatus.PENDING,
      priority,
    });
    const saved = await this.notificationRepository.save(notification);

    if (priority === NotificationPriority.LOW && channel === NotificationChannel.IN_APP) {
      // Low-priority in-app notifications (e.g. signal/price updates) are
      // batched into a scheduled digest by DigestService rather than
      // delivered immediately; urgent notifications always go straight
      // onto the delivery queue below.
      this.logger.debug(`Notification ${saved.id} deferred to digest (type=${dto.type})`);
      return saved;
    }

    await this.notificationQueue.add('deliver', { notificationId: saved.id }, {
      priority: 100,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    return saved;
  }

  async findForUser(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ data: Notification[]; total: number; unread: number }> {
    const [data, total] = await this.notificationRepository.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const unread = await this.notificationRepository.count({
      where: { userId, status: NotificationStatus.PENDING },
    });

    return { data, total, unread };
  }

  async markAsRead(id: string, userId: string): Promise<Notification> {
    const notification = await this.notificationRepository.findOne({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }

    notification.status = NotificationStatus.READ;
    notification.readAt = new Date();
    return this.notificationRepository.save(notification);
  }

  async markAllAsRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notificationRepository
      .createQueryBuilder()
      .update(Notification)
      .set({ status: NotificationStatus.READ, readAt: new Date() })
      .where('user_id = :userId AND status != :status', {
        userId,
        status: NotificationStatus.READ,
      })
      .execute();

    return { updated: result.affected ?? 0 };
  }

  private mapTypeToPreference(type: string): 'tradeUpdates' | 'signalPerformance' | 'systemAlerts' | 'marketing' | null {
    const map: Record<string, 'tradeUpdates' | 'signalPerformance' | 'systemAlerts' | 'marketing'> = {
      TRADE_EXECUTED: 'tradeUpdates',
      TRADE_PENDING: 'tradeUpdates',
      TRADE_CANCELLED: 'tradeUpdates',
      TRADE_FAILED: 'tradeUpdates',
      SIGNAL_CREATED: 'signalPerformance',
      SIGNAL_UPDATED: 'signalPerformance',
      SIGNAL_CLOSED: 'signalPerformance',
      RISK_ALERT: 'systemAlerts',
      PRICE_ALERT: 'systemAlerts',
      SUBSCRIPTION_CREATED: 'systemAlerts',
      SUBSCRIPTION_CANCELLED: 'systemAlerts',
      SUBSCRIPTION_PAUSED: 'systemAlerts',
      SUBSCRIPTION_RESUMED: 'systemAlerts',
      SUBSCRIPTION_RENEWED: 'systemAlerts',
      SUBSCRIPTION_PAYMENT_FAILED: 'systemAlerts',
    };
    return map[type] ?? null;
  }
}
