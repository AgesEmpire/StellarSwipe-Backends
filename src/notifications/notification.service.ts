import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Notification, NotificationChannel, NotificationStatus } from './entities/notification.entity';
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

    const notification = this.notificationRepository.create({
      ...dto,
      channel,
      status: NotificationStatus.PENDING,
    });
    const saved = await this.notificationRepository.save(notification);

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
    };
    return map[type] ?? null;
  }
}
