import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Notification } from './entities/notification.entity';
import { NotificationType, NotificationChannel } from './entities/notification.entity';
import { NOTIFICATION_QUEUE } from './notification.queue';

/**
 * Security events that are considered high-risk and therefore eligible for
 * delivery through the configured email and SMS channels.
 */
const HIGH_RISK_SECURITY_EVENTS: ReadonlySet<NotificationType> = new Set([
  NotificationType.SECURITY_ALERT,
  NotificationType.LOGIN_ALERT,
  NotificationType.PASSWORD_CHANGED,
  NotificationType.SUSPICIOUS_ACTIVITY,
]);

/**
 * Keys whose values must never be included in a delivered security alert.
 */
const SENSITIVE_METADATA_KEYS: ReadonlySet<string> = new Set([
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'secret',
  'authorization',
  'cookie',
  'ip',
  'ipAddress',
  'userAgent',
]);

const REDACTED = '[REDACTED]';

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
    this.logger.log(`Creating notification for user ${userId}`);

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

    // Queue the notification for processing (NORMAL priority)
    await this.notificationQueue.add('send-notification', {
      notificationId: savedNotification.id,
    }, {
      priority: 100, // NORMAL
      // Job options
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    this.logger.log(`Queued notification ${savedNotification.id} for processing`);
    return savedNotification;
  }

  /**
   * Deliver a high-risk security event through the configured email and SMS
   * channels. User preferences and disabled channels are respected, and the
   * message content is redacted before it is queued for delivery.
   *
   * @param userId The user ID the security event belongs to
   * @param type The security event type
   * @param title The alert title
   * @param message The alert message
   * @param metadata Additional event data (sensitive keys are redacted)
   * @param preferences The user's notification channel preferences
   * @returns The created notification records, one per eligible channel
   */
  async deliverSecurityAlert(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    metadata: Record<string, any> = {},
    preferences: { email?: boolean; sms?: boolean } = {},
  ): Promise<Notification[]> {
    if (!HIGH_RISK_SECURITY_EVENTS.has(type)) {
      this.logger.debug(`Skipping non-high-risk security event ${type} for user ${userId}`);
      return [];
    }

    const channels = this.resolveSecurityAlertChannels(preferences);
    if (channels.length === 0) {
      this.logger.warn(`No enabled channels for security alert ${type} for user ${userId}`);
      return [];
    }

    const redactedMetadata = this.redactMetadata(metadata);
    const redactedMessage = this.redactMessage(message);

    const delivered: Notification[] = [];
    for (const channel of channels) {
      try {
        const notification = await this.createAndQueueNotification(
          userId,
          type,
          title,
          redactedMessage,
          channel,
          redactedMetadata,
        );
        delivered.push(notification);
      } catch (error) {
        // Provider/queue failures are handled through the existing queue
        // retry/backoff abstraction; log and continue with remaining channels.
        this.logger.error(
          `Failed to queue security alert ${type} on ${channel} for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return delivered;
  }

  /**
   * Resolve the configured channels for a security alert, honouring user
   * preferences and skipping disabled channels.
   */
  private resolveSecurityAlertChannels(
    preferences: { email?: boolean; sms?: boolean },
  ): NotificationChannel[] {
    const channels: NotificationChannel[] = [];

    if (preferences.email !== false) {
      channels.push(NotificationChannel.EMAIL);
    }
    if (preferences.sms !== false) {
      channels.push(NotificationChannel.SMS);
    }

    return channels;
  }

  /**
   * Redact sensitive values from alert metadata before delivery.
   */
  private redactMetadata(metadata: Record<string, any>): Record<string, any> {
    const redacted: Record<string, any> = {};

    for (const [key, value] of Object.entries(metadata ?? {})) {
      if (SENSITIVE_METADATA_KEYS.has(key)) {
        redacted[key] = REDACTED;
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        redacted[key] = this.redactMetadata(value as Record<string, any>);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  /**
   * Redact sensitive values that may have been interpolated into the message.
   */
  private redactMessage(message: string): string {
    if (!message) {
      return message;
    }

    return message.replace(
      /(password|token|secret|api[_-]?key|authorization)\s*[:=]\s*\S+/gi,
      `$1: ${REDACTED}`,
    );
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
