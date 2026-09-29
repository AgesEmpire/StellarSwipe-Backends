import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Notification,
  NotificationChannel,
  NotificationStatus,
  CONSENT_GATED_NOTIFICATION_TYPES,
} from './entities/notification.entity';
import {
  NotificationDeliveryAuditLog,
} from './entities/notification-delivery-audit-log.entity';
import { ConsentCategory } from './entities/user-consent.entity';
import { NOTIFICATION_QUEUE } from './notification.service';
import { DeadLetterService } from '../jobs/dead-letter.service';
import { ConsentService } from './consent.service';
import { SocketManagerService } from '../websocket/services/socket-manager.service';

const WEBSOCKET_CHANNELS = new Set<NotificationChannel>([
  NotificationChannel.IN_APP,
  NotificationChannel.PUSH,
  NotificationChannel.BOTH,
]);

export const RECIPIENT_OFFLINE_REASON = 'Recipient offline; persisted for later retrieval';

@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(NotificationDeliveryAuditLog)
    private readonly auditRepository: Repository<NotificationDeliveryAuditLog>,
    private readonly consentService: ConsentService,
    private readonly deadLetterService: DeadLetterService,
    private readonly socketManager: SocketManagerService,
  ) {}

  @Process('deliver')
  async handleDeliver(job: Job<{ notificationId: string }>): Promise<void> {
    const { notificationId } = job.data;
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId },
    });

    if (!notification) {
      this.logger.warn(
        `Notification ${notificationId} not found for delivery`,
      );
      return;
    }

    const skippedReason = await this.checkConsentSkip(notification);
    if (skippedReason) {
      this.logger.log(
        `NotificationSkippedDueToConsent: notification ${notificationId} ` +
          `for user ${notification.userId} (${skippedReason})`,
      );
      await this.auditRepository.save(
        this.auditRepository.create({
          userId: notification.userId,
          notificationId: notification.id,
          notificationType: notification.type,
          channel: notification.channel,
          deliveredAt: null,
          skippedReason,
        }),
      );
      return;
    }

    try {
      this.logger.log(
        `Delivering notification ${notificationId} via ` +
          `${notification.channel} to user ${notification.userId}`,
      );

      if (WEBSOCKET_CHANNELS.has(notification.channel)) {
        const online = await this.socketManager.isUserOnline(notification.userId);
        if (!online) {
          // Notification stays persisted (PENDING) and is served via the inbox API
          this.logger.log(
            `Recipient ${notification.userId} offline; notification ${notificationId} persisted`,
          );
          await this.auditRepository.save(
            this.auditRepository.create({
              userId: notification.userId,
              notificationId: notification.id,
              notificationType: notification.type,
              channel: notification.channel,
              deliveredAt: null,
              skippedReason: RECIPIENT_OFFLINE_REASON,
            }),
          );
          return;
        }

        // Emitted only to the user's private room, which sockets join after JWT auth
        this.socketManager.emitNotification(notification.userId, {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          metadata: notification.metadata,
          createdAt: notification.createdAt,
        });
      }

      notification.status = NotificationStatus.SENT;
      await this.notificationRepository.save(notification);

      await this.auditRepository.save(
        this.auditRepository.create({
          userId: notification.userId,
          notificationId: notification.id,
          notificationType: notification.type,
          channel: notification.channel,
          deliveredAt: new Date(),
          skippedReason: null,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to deliver notification ${notificationId}`,
        error,
      );
      notification.status = NotificationStatus.FAILED;
      await this.notificationRepository.save(notification);
      throw error; // triggers Bull retry
    }
  }

  /**
   * Returns a skip reason if this notification is consent-gated (marketing
   * types over email/push) and the user has not opted in; otherwise null,
   * meaning delivery should proceed. Security alerts and trade confirmations
   * are never consent-gated.
   */
  private async checkConsentSkip(
    notification: Notification,
  ): Promise<string | null> {
    const isConsentGated = CONSENT_GATED_NOTIFICATION_TYPES.has(
      notification.type,
    );
    if (
      !isConsentGated ||
      notification.channel === NotificationChannel.IN_APP
    ) {
      return null;
    }

    const consentCategory =
      notification.channel === NotificationChannel.EMAIL
        ? ConsentCategory.MARKETING_EMAIL
        : ConsentCategory.MARKETING_PUSH;

    const hasConsent = await this.consentService.hasConsented(
      notification.userId,
      consentCategory,
    );
    return hasConsent ? null : `No consent for ${consentCategory}`;
  }

  @OnQueueFailed()
  async onFailed(job: Job, error: Error): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= attempts) {
      await this.deadLetterService.capture(job, error);
    }
  }
}
