import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { NotificationPreference } from '../preferences/entities/notification-preference.entity';
import { EmailService } from '../../email/email.service';
import { SmsService } from '../../sms/sms.service';
import { SocketManagerService } from '../../websocket/services/socket-manager.service';
import { NotificationType, NotificationChannel, NotificationStatus } from '../entities/notification.entity';

export const NOTIFICATION_QUEUE = 'notifications';

@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepository: Repository<NotificationPreference>,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly socketManagerService: SocketManagerService,
  ) {}

  @Process('send-notification')
  async processNotification(job: Job<{
    notificationId: string;
  }>): Promise<void> {
    const { notificationId } = job.data;
    this.logger.log(Processing notification );

    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId },
    });

    if (!notification) {
      this.logger.error(Notification  not found);
      return;
    }

    // Update status to sending
    notification.status = NotificationStatus.SENT;
    await this.notificationRepository.save(notification);

    try {
      // Check user preferences
      const preferences = await this.preferenceRepository.findOne({
        where: { userId: notification.userId },
      });

      // Determine if we should send based on preferences and channel
      let shouldSend = true;
      if (preferences) {
        switch (notification.type) {
          case NotificationType.TRADE_EXECUTED:
          case NotificationType.TRADE_CLOSED:
            shouldSend = notification.channel === NotificationChannel.EMAIL 
              ? preferences?.tradeUpdatesEmail 
              : notification.channel === NotificationChannel.PUSH
                ? preferences?.tradeUpdatesPush
                : preferences?.tradeUpdatesEmail || preferences?.tradeUpdatesPush;
            break;
          case NotificationType.SIGNAL_TARGET_HIT:
          case NotificationType.SIGNAL_STOP_LOSS:
            shouldSend = notification.channel === NotificationChannel.EMAIL
              ? preferences?.signalPerformanceEmail
              : notification.channel === NotificationChannel.PUSH
                ? preferences?.signalPerformancePush
                : preferences?.signalPerformanceEmail || preferences?.signalPerformancePush;
            break;
          case NotificationType.SYSTEM_ALERT:
            shouldSend = notification.channel === NotificationChannel.EMAIL
              ? preferences?.systemAlertsEmail
              : notification.channel === NotificationChannel.PUSH
                ? preferences?.systemAlertsPush
                : preferences?.systemAlertsEmail || preferences?.systemAlertsPush;
            break;
          case NotificationType.MARKETING:
            shouldSend = notification.channel === NotificationChannel.EMAIL
              ? preferences?.marketingEmail
              : notification.channel === NotificationChannel.PUSH
                ? preferences?.marketingPush
                : preferences?.marketingEmail || preferences?.marketingPush;
            break;
        }
      }

      if (!shouldSend) {
        this.logger.log(Notification  skipped due to user preferences);
        notification.status = NotificationStatus.SENT; // Still mark as sent since we chose not to
        await this.notificationRepository.save(notification);
        return;
      }

      // Send via appropriate channels
      switch (notification.channel) {
        case NotificationChannel.EMAIL:
          await this.sendEmailNotification(notification);
          break;
        case NotificationChannel.PUSH:
          await this.sendPushNotification(notification);
          break;
        case NotificationChannel.BOTH:
          await this.sendEmailNotification(notification);
          await this.sendPushNotification(notification);
          break;
      }

      // Mark as sent
      notification.status = NotificationStatus.SENT;
      notification.sentAt = new Date();
      await this.notificationRepository.save(notification);

      this.logger.log(Notification  sent successfully);
    } catch (error) {
      this.logger.error(Failed to send notification :, error);
      notification.status = NotificationStatus.FAILED;
      notification.errorMessage = error.message;
      notification.retryCount += 1;
      await this.notificationRepository.save(notification);
      throw error; // Let Bull handle retries
    }
  }

  private async sendEmailNotification(notification: Notification): Promise<void> {
    // Map notification type to email template
    const templateMap: Record<NotificationType, string> = {
      [NotificationType.TRADE_EXECUTED]: 'trade-executed',
      [NotificationType.TRADE_CLOSED]: 'trade-executed', // Could be customized
      [NotificationType.SIGNAL_TARGET_HIT]: 'signal-performance',
      [NotificationType.SIGNAL_STOP_LOSS]: 'signal-performance',
      [NotificationType.SYSTEM_ALERT]: 'security-alert',
      [NotificationType.MARKETING]: 'weekly-summary', // Could be customized
    };

    const template = templateMap[notification.type];
    if (!template) {
      throw new Error(No email template mapped for notification type );
    }

    // Prepare email variables from metadata
    const variables = notification.metadata || {};

    // Send email
    await this.emailService.sendEmail({
      to: notification.metadata?.email || '', // Would need to get from user service in real implementation
      template,
      variables,
    });

    this.logger.log(Email sent for notification );
  }

  private async sendPushNotification(notification: Notification): Promise<void> {
    // Send via websocket as push notification
    const userId = notification.userId;
    
    // In a real implementation, you'd map userId to wallet address or socket ID
    // For now, we'll broadcast to a user-specific room
    // This assumes you have a way to map userId to socket connections
    
    const payload = {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      timestamp: new Date().toISOString(),
      metadata: notification.metadata,
    };

    // Emit to user's socket room (would need to implement userId to socket mapping)
    // For now, we'll log that we would send it
    this.logger.log(Would send push notification to user :, payload);
    
    // TODO: Implement actual push notification sending via websocket
    // This would require maintaining a mapping of userId to socket connections
  }

  @OnQueueFailed()
  async handleFailed(job: Job<any>, error: Error): Promise<void> {
    this.logger.error(Notification job  failed:, error);
    
    if (job.data?.notificationId) {
      const notification = await this.notificationRepository.findOne({
        where: { id: job.data.notificationId },
      });
      
      if (notification) {
        notification.status = NotificationStatus.FAILED;
        notification.errorMessage = error.message;
        notification.retryCount += 1;
        await this.notificationRepository.save(notification);
      }
    }
  }
}
