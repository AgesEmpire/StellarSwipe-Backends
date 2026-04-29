import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Notification, NotificationChannel, NotificationStatus } from './entities/notification.entity';
import { SendNotificationDto } from './dto/send-notification.dto';
import { PreferencesService } from './preferences/preferences.service';

export const NOTIFICATION_QUEUE = 'notifications';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    private readonly preferencesService: PreferencesService,
  ) {}

  async send(dto: SendNotificationDto): Promise<Notification> {
    const channel = dto.channel ?? NotificationChannel.IN_APP;

    // Check user preferences before sending
    const channelKey = channel === NotificationChannel.EMAIL ? 'email' : 'push';
    const typeKey = this.mapTypeToPreference(dto.type);
    if (typeKey && channel !== NotificationChannel.IN_APP) {
      const enabled = await this.preferencesService.isEnabled(dto.userId, typeKey, channelKey as any);
      if (!enabled) {
        this.logger.log(`Notification suppressed for user ${dto.userId}: ${typeKey}/${channelKey} disabled`);
        // Still create in-app record but mark as sent
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

    // Enqueue for async delivery
    await this.notificationQueue.add('deliver', { notificationId: saved.id }, {
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
      SIGNAL_CREATED: 'signalPerformance',
      SIGNAL_UPDATED: 'signalPerformance',
      SIGNAL_CLOSED: 'signalPerformance',
      RISK_ALERT: 'systemAlerts',
      PRICE_ALERT: 'systemAlerts',
    };
    return map[type] ?? null;
  }
}
