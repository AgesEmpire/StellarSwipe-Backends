import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Notification } from './entities/notification.entity';
import { NotificationType, NotificationChannel } from './entities/notification.entity';
import { NOTIFICATION_QUEUE } from './notification.queue';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
  ) {}

  /**
   * Create and queue a notification for delivery
   * @param userId The user ID to send the notification to
   * @param type The type of notification (trade success/failure/alert)
   * @param title The notification title
   * @param message The notification message
   * @param channel The delivery channel (email, push, or both)
   * @param metadata Additional data to include with the notification
   * @returns The created notification record
   */
  async createAndQueueNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    channel: NotificationChannel,
    metadata: Record<string, any> = {},
  ): Promise<Notification> {
    this.logger.log(Creating notification for user : );

    // Create notification record
    const notification = this.notificationRepository.create({
      userId,
      type,
      title,
      message,
      channel,
      metadata,
      status: 'PENDING',
    });

    const savedNotification = await this.notificationRepository.save(notification);

    // Queue the notification for processing
    await this.notificationQueue.add('send-notification', {
      notificationId: savedNotification.id,
    }, {
      // Job options
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    this.logger.log(Queued notification  for processing);
    return savedNotification;
  }

  /**
   * Get notification by ID
   */
  async findById(id: string): Promise<Notification | null> {
    return this.notificationRepository.findOne({ where: { id } });
  }

  /**
   * Get notifications for a user
   */
  async findByUserId(userId: string, limit = 50, offset = 0): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Mark notification as sent (called internally by processor)
   */
  async markAsSent(id: string): Promise<void> {
    await this.notificationRepository.update(id, {
      status: 'SENT',
      sentAt: new Date(),
    });
  }

  /**
   * Mark notification as failed (called internally by processor)
   */
  async markAsFailed(id: string, errorMessage: string): Promise<void> {
    await this.notificationRepository.update(id, {
      status: 'FAILED',
      errorMessage,
    });
  }
}
