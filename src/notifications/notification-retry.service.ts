import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Repository } from 'typeorm';
import { Queue } from 'bull';
import { Notification, NotificationStatus } from './entities/notification.entity';
import { NotificationDeliveryAuditLog } from './entities/notification-delivery-audit-log.entity';
import { NOTIFICATION_QUEUE } from './notification.service';

/** Minimum time between manual retries of the same notification. */
export const RETRY_COOLDOWN_MS = 60_000;

/** Failed attempts (automatic and manual) allowed before retries stop. */
export const MAX_FAILED_ATTEMPTS = 9;

export interface RetryNotificationResult {
  notificationId: string;
  jobId: string;
  queued: boolean;
}

@Injectable()
export class NotificationRetryService {
  private readonly logger = new Logger(NotificationRetryService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(NotificationDeliveryAuditLog)
    private readonly auditRepository: Repository<NotificationDeliveryAuditLog>,
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
  ) {}

  /**
   * Re-queue a failed, transiently-failed notification owned by `userId`.
   *
   * The job id is derived from the number of failed attempts so far, which
   * makes concurrent retry requests for the same failure round collapse into
   * one Bull job, while a later failure round gets a fresh id.
   */
  async retry(notificationId: string, userId: string): Promise<RetryNotificationResult> {
    // Scoped by owner so another user's notification looks like it doesn't exist.
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, userId },
    });
    if (!notification) {
      throw new NotFoundException(`Notification ${notificationId} not found`);
    }

    if (
      notification.status === NotificationStatus.SENT ||
      notification.status === NotificationStatus.READ
    ) {
      throw new ConflictException('Notification was already delivered');
    }
    if (notification.status !== NotificationStatus.FAILED) {
      throw new ConflictException('Only failed notifications can be retried');
    }

    const attempts = await this.auditRepository.find({
      where: { notificationId },
      order: { createdAt: 'DESC' },
    });
    if (attempts.some((attempt) => attempt.deliveredAt !== null)) {
      throw new ConflictException('Notification was already delivered');
    }

    const failures = attempts.filter((attempt) => attempt.errorMessage !== null);
    const latestFailure = failures[0];
    if (!latestFailure) {
      throw new UnprocessableEntityException('No failed attempt is recorded for this notification');
    }
    if (!latestFailure.retryable) {
      throw new UnprocessableEntityException('The last failure was permanent and cannot be retried');
    }
    if (failures.length >= MAX_FAILED_ATTEMPTS) {
      throw new UnprocessableEntityException('Retry limit reached for this notification');
    }
    if (Date.now() - latestFailure.createdAt.getTime() < RETRY_COOLDOWN_MS) {
      throw new HttpException(
        'Please wait before retrying this notification again',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const jobId = `deliver-${notification.id}-retry-${failures.length}`;
    await this.notificationQueue.add(
      'deliver',
      { notificationId: notification.id },
      {
        jobId,
        priority: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    this.logger.log(
      `Retry queued for notification ${notification.id} (job ${jobId}) after ${failures.length} failed attempt(s)`,
    );
    return { notificationId: notification.id, jobId, queued: true };
  }
}
