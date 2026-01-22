import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ExpirationNotification,
  NotificationType,
  NotificationStatus,
  NotificationChannel,
} from '../entities/expiration-notification.entity';
import { Signal } from '../entities/signal.entity';
import { CopiedPosition, AutoCloseReason } from '../entities/copied-position.entity';

@Injectable()
export class ExpirationNotificationService {
  private readonly logger = new Logger(ExpirationNotificationService.name);

  constructor(
    @InjectRepository(ExpirationNotification)
    private notificationRepository: Repository<ExpirationNotification>,
  ) {}

  async notifyExpirationWarning(
    userId: string,
    signal: Signal,
    position: CopiedPosition,
    minutesUntilExpiration: number,
  ): Promise<ExpirationNotification> {
    const notification = this.notificationRepository.create({
      userId,
      signalId: signal.id,
      positionId: position.id,
      type: NotificationType.EXPIRATION_WARNING,
      status: NotificationStatus.PENDING,
      channel: NotificationChannel.IN_APP,
      title: 'Signal Expiring Soon',
      message: `Your position in ${signal.baseAsset}/${signal.counterAsset} will expire in ${minutesUntilExpiration} minutes. Please review your position.`,
      data: {
        signalId: signal.id,
        positionId: position.id,
        baseAsset: signal.baseAsset,
        counterAsset: signal.counterAsset,
        expiresAt: signal.expiresAt.toISOString(),
        minutesUntilExpiration,
      },
    });

    await this.notificationRepository.save(notification);
    await this.sendNotification(notification);

    this.logger.log(
      `Expiration warning sent to user ${userId} for signal ${signal.id}`,
    );

    return notification;
  }

  async notifyGracePeriodStarted(
    userId: string,
    signal: Signal,
    position: CopiedPosition,
    gracePeriodMinutes: number,
  ): Promise<ExpirationNotification> {
    const gracePeriodEndsAt = new Date(
      Date.now() + gracePeriodMinutes * 60 * 1000,
    );

    const notification = this.notificationRepository.create({
      userId,
      signalId: signal.id,
      positionId: position.id,
      type: NotificationType.GRACE_PERIOD_STARTED,
      status: NotificationStatus.PENDING,
      channel: NotificationChannel.IN_APP,
      title: 'Grace Period Started',
      message: `The signal for ${signal.baseAsset}/${signal.counterAsset} has expired. Your position will remain open for ${gracePeriodMinutes} more minutes.`,
      data: {
        signalId: signal.id,
        positionId: position.id,
        baseAsset: signal.baseAsset,
        counterAsset: signal.counterAsset,
        gracePeriodMinutes,
        gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
      },
    });

    await this.notificationRepository.save(notification);
    await this.sendNotification(notification);

    this.logger.log(
      `Grace period notification sent to user ${userId} for signal ${signal.id}`,
    );

    return notification;
  }

  async notifyPositionAutoClosed(
    userId: string,
    signal: Signal,
    position: CopiedPosition,
    reason: AutoCloseReason,
  ): Promise<ExpirationNotification> {
    const reasonMessages: Record<AutoCloseReason, string> = {
      [AutoCloseReason.SIGNAL_EXPIRED]: 'signal expiration',
      [AutoCloseReason.SIGNAL_CANCELLED]: 'signal cancellation by provider',
      [AutoCloseReason.TARGET_HIT]: 'target price reached',
      [AutoCloseReason.STOP_LOSS_HIT]: 'stop loss triggered',
      [AutoCloseReason.GRACE_PERIOD_ENDED]: 'grace period ending',
      [AutoCloseReason.USER_MANUAL]: 'your request',
    };

    const notification = this.notificationRepository.create({
      userId,
      signalId: signal.id,
      positionId: position.id,
      type: NotificationType.POSITION_AUTO_CLOSED,
      status: NotificationStatus.PENDING,
      channel: NotificationChannel.IN_APP,
      title: 'Position Auto-Closed',
      message: `Your position in ${signal.baseAsset}/${signal.counterAsset} has been automatically closed due to ${reasonMessages[reason]}.`,
      data: {
        signalId: signal.id,
        positionId: position.id,
        baseAsset: signal.baseAsset,
        counterAsset: signal.counterAsset,
        reason,
        closedAt: new Date().toISOString(),
        pnlPercentage: position.pnlPercentage,
        pnlAbsolute: position.pnlAbsolute,
      },
    });

    await this.notificationRepository.save(notification);
    await this.sendNotification(notification);

    this.logger.log(
      `Auto-close notification sent to user ${userId} for position ${position.id}`,
    );

    return notification;
  }

  async notifySignalCancelled(
    userId: string,
    signal: Signal,
    position: CopiedPosition,
  ): Promise<ExpirationNotification> {
    const notification = this.notificationRepository.create({
      userId,
      signalId: signal.id,
      positionId: position.id,
      type: NotificationType.SIGNAL_CANCELLED,
      status: NotificationStatus.PENDING,
      channel: NotificationChannel.IN_APP,
      title: 'Signal Cancelled',
      message: `The signal provider has cancelled the ${signal.baseAsset}/${signal.counterAsset} signal. Your position has been closed.`,
      data: {
        signalId: signal.id,
        positionId: position.id,
        baseAsset: signal.baseAsset,
        counterAsset: signal.counterAsset,
        cancelledAt: new Date().toISOString(),
      },
    });

    await this.notificationRepository.save(notification);
    await this.sendNotification(notification);

    this.logger.log(
      `Cancellation notification sent to user ${userId} for signal ${signal.id}`,
    );

    return notification;
  }

  async notifySignalExpired(
    userId: string,
    signal: Signal,
    position: CopiedPosition,
  ): Promise<ExpirationNotification> {
    const notification = this.notificationRepository.create({
      userId,
      signalId: signal.id,
      positionId: position.id,
      type: NotificationType.SIGNAL_EXPIRED,
      status: NotificationStatus.PENDING,
      channel: NotificationChannel.IN_APP,
      title: 'Signal Expired',
      message: `The ${signal.baseAsset}/${signal.counterAsset} signal has expired. Your position remains open - please decide what action to take.`,
      data: {
        signalId: signal.id,
        positionId: position.id,
        baseAsset: signal.baseAsset,
        counterAsset: signal.counterAsset,
        expiredAt: new Date().toISOString(),
      },
    });

    await this.notificationRepository.save(notification);
    await this.sendNotification(notification);

    this.logger.log(
      `Expiration notification sent to user ${userId} for signal ${signal.id}`,
    );

    return notification;
  }

  async getUserNotifications(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<ExpirationNotification[]> {
    return this.notificationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async getUnreadNotifications(userId: string): Promise<ExpirationNotification[]> {
    return this.notificationRepository.find({
      where: {
        userId,
        status: NotificationStatus.SENT,
        readAt: undefined,
      },
      order: { createdAt: 'DESC' },
    });
  }

  async markAsRead(notificationId: string): Promise<ExpirationNotification> {
    const notification = await this.notificationRepository.findOneOrFail({
      where: { id: notificationId },
    });

    notification.status = NotificationStatus.READ;
    notification.readAt = new Date();

    return this.notificationRepository.save(notification);
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.notificationRepository.update(
      {
        userId,
        status: NotificationStatus.SENT,
      },
      {
        status: NotificationStatus.READ,
        readAt: new Date(),
      },
    );

    return result.affected ?? 0;
  }

  private async sendNotification(
    notification: ExpirationNotification,
  ): Promise<void> {
    try {
      // In a real implementation, this would send via the appropriate channel
      // For now, we just mark it as sent
      notification.status = NotificationStatus.SENT;
      notification.sentAt = new Date();
      await this.notificationRepository.save(notification);

      this.logger.debug(
        `Notification ${notification.id} sent via ${notification.channel}`,
      );
    } catch (error) {
      notification.status = NotificationStatus.FAILED;
      await this.notificationRepository.save(notification);

      this.logger.error(
        `Failed to send notification ${notification.id}: ${error}`,
      );
    }
  }
}
