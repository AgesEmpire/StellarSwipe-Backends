import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Notification,
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  NotificationType,
} from '../entities/notification.entity';
import { PreferencesService } from '../preferences/preferences.service';
import { NOTIFICATION_QUEUE } from '../notification.service';
import { I18nAppService } from '../../i18n/i18n.service';

/**
 * Groups eligible low-priority notifications (signal updates, price
 * alerts, marketing) into configurable scheduled digests, so users aren't
 * interrupted by every one individually while urgent notifications (trade
 * lifecycle, KYC, risk/balance alerts) remain untouched and immediate.
 *
 * Low-priority notifications are created by NotificationService with
 * `digestedAt = null` and are *not* queued for delivery on their own; this
 * service is the only thing that queues them, bundled, once per scheduled
 * run — so an item is never delivered twice.
 */
@Injectable()
export class DigestService {
  private readonly logger = new Logger(DigestService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
    private readonly preferencesService: PreferencesService,
    private readonly i18n: I18nAppService,
  ) {}

  /**
   * Runs hourly; `PreferencesService.isDigestDue` decides per-user whether
   * this is actually their scheduled slot (hourly users: every run; daily
   * users: only the run matching their configured hour in their
   * timezone), and defers while the user is in quiet hours.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async runScheduledDigests(): Promise<void> {
    const now = new Date();
    const duePreferences = await this.preferencesService.findPreferencesDueForDigest(now);

    this.logger.log(`Running scheduled digests for ${duePreferences.length} user(s)`);

    for (const preference of duePreferences) {
      try {
        await this.sendDigestForUser(preference.userId, preference.locale);
      } catch (error) {
        this.logger.error(
          `Failed to send digest for user ${preference.userId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  /**
   * Bundle every pending, not-yet-digested, low-priority in-app
   * notification for `userId` into a single digest notification and queue
   * it for delivery. Each bundled item is marked `digestedAt` (and
   * `SENT`) so it is excluded from this and every later digest run, and
   * is never delivered individually afterwards — items are not sent
   * twice.
   *
   * Returns `null` when there is nothing to digest.
   */
  async sendDigestForUser(userId: string, locale = 'en'): Promise<Notification | null> {
    const pending = await this.notificationRepository.find({
      where: {
        userId,
        channel: NotificationChannel.IN_APP,
        priority: NotificationPriority.LOW,
        digestedAt: IsNull(),
      },
      order: { createdAt: 'ASC' },
    });

    if (pending.length === 0) {
      return null;
    }

    const title = await this.i18n.translate('notifications.DIGEST_TITLE', locale, {
      count: pending.length,
    });
    const message = await this.i18n.translate('notifications.DIGEST_SUMMARY', locale, {
      count: pending.length,
    });

    const digest = this.notificationRepository.create({
      userId,
      type: NotificationType.SYSTEM,
      channel: NotificationChannel.IN_APP,
      title,
      message,
      status: NotificationStatus.PENDING,
      priority: NotificationPriority.URGENT, // the digest itself is always delivered, never re-digested
      metadata: {
        digest: true,
        itemIds: pending.map((notification) => notification.id),
        itemCount: pending.length,
        itemTypes: [...new Set(pending.map((notification) => notification.type))],
      },
    });
    const savedDigest = await this.notificationRepository.save(digest);

    const digestedAt = new Date();
    await this.notificationRepository.update(
      pending.map((notification) => notification.id),
      { digestedAt, status: NotificationStatus.SENT },
    );

    await this.notificationQueue.add(
      'deliver',
      { notificationId: savedDigest.id },
      { priority: 150, attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );

    this.logger.log(`Queued digest ${savedDigest.id} for user ${userId} with ${pending.length} item(s)`);
    return savedDigest;
  }
}
