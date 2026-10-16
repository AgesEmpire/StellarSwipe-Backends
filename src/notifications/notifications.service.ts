import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
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

/**
 * Roles permitted to inspect and recover dead-lettered notification jobs.
 */
const DEAD_LETTER_OPERATOR_ROLES: ReadonlySet<string> = new Set([
  'admin',
  'operator',
  'support',
]);

/**
 * Maximum number of dead-letter jobs that may be retried in a single request.
 * Bounds the blast radius of an operational recovery action.
 */
const MAX_DEAD_LETTER_RETRY_BATCH = 50;

/**
 * Safe, non-sensitive view of a permanently failed notification job.
 */
export interface DeadLetterJobSummary {
  id: string;
  notificationId: string;
  type: NotificationType;
  channel: NotificationChannel;
  status: string;
  attemptsMade: number;
  failedAt: Date | null;
  errorMessage: string | null;
}

/**
 * Result of a bounded dead-letter retry operation.
 */
export interface DeadLetterRetryResult {
  requested: number;
  retried: string[];
  skipped: string[];
}

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

  /**
   * Inspect permanently failed notification jobs (dead-letter queue).
   *
   * Only safe metadata is exposed: the notification id, type, channel,
   * status, attempt count, failure timestamp and error message. Raw job
   * payloads and user metadata are never returned.
   *
   * @param actorRole Role of the operator requesting the inspection
   * @param limit Maximum number of dead-letter jobs to return
   * @returns Safe summaries of the failed jobs
   */
  async inspectDeadLetterJobs(
    actorRole: string,
    limit = 50,
  ): Promise<DeadLetterJobSummary[]> {
    this.assertDeadLetterOperator(actorRole);

    const boundedLimit = Math.min(Math.max(limit, 1), MAX_DEAD_LETTER_RETRY_BATCH);
    const failedJobs = await this.notificationQueue.getFailed(0, boundedLimit - 1);

    const summaries: DeadLetterJobSummary[] = [];
    for (const job of failedJobs) {
      const notificationId = job?.data?.notificationId;
      if (!notificationId) {
        continue;
      }

      const notification = await this.notificationRepository.findOne({
        where: { id: notificationId },
      });
      if (!notification) {
        continue;
      }

      summaries.push({
        id: String(job.id),
        notificationId: notification.id,
        type: notification.type,
        channel: notification.channel,
        status: notification.status,
        attemptsMade: job.attemptsMade ?? 0,
        failedAt: job.failedReason ? job.finishedOn ? new Date(job.finishedOn) : null : null,
        errorMessage: notification.errorMessage ?? job.failedReason ?? null,
      });
    }

    this.logger.log(
      `Operator with role ${actorRole} inspected ${summaries.length} dead-letter notification job(s)`,
    );

    return summaries;
  }

  /**
   * Retry eligible permanently failed notification jobs.
   *
   * Retries are bounded to {@link MAX_DEAD_LETTER_RETRY_BATCH} jobs per call,
   * only jobs whose notification is still in a FAILED state are retried, and
   * every retry is audited with the acting operator role.
   *
   * @param actorRole Role of the operator requesting the retry
   * @param jobIds Dead-letter job ids to retry
   * @returns The retried and skipped job ids
   */
  async retryDeadLetterJobs(
    actorRole: string,
    jobIds: string[],
  ): Promise<DeadLetterRetryResult> {
    this.assertDeadLetterOperator(actorRole);

    const requested = Array.isArray(jobIds) ? jobIds.slice(0, MAX_DEAD_LETTER_RETRY_BATCH) : [];
    const retried: string[] = [];
    const skipped: string[] = [];

    for (const jobId of requested) {
      const job = await this.notificationQueue.getJob(jobId);
      if (!job) {
        skipped.push(jobId);
        continue;
      }

      const notificationId = job?.data?.notificationId;
      const notification = notificationId
        ? await this.notificationRepository.findOne({ where: { id: notificationId } })
        : null;

      // Only retry jobs whose notification is still permanently failed.
      if (!notification || notification.status !== 'FAILED') {
        skipped.push(jobId);
        continue;
      }

      await job.retry();
      await this.notificationRepository.update(notification.id, {
        status: 'PENDING',
        errorMessage: null,
      });

      retried.push(jobId);
      this.logger.log(
        `Audit: operator with role ${actorRole} retried dead-letter notification job ${jobId} (notification ${notification.id})`,
      );
    }

    return { requested: requested.length, retried, skipped };
  }

  /**
   * Enforce that the acting role is authorized for dead-letter operations.
   */
  private assertDeadLetterOperator(actorRole: string): void {
    if (!actorRole || !DEAD_LETTER_OPERATOR_ROLES.has(actorRole)) {
      throw new ForbiddenException('Not authorized to manage dead-letter notification jobs');
    }
  }
}
