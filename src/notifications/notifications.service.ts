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
 * Public provider profile / trading configuration fields whose changes are
 * considered important enough to notify opted-in subscribers about.
 */
const PROVIDER_PROFILE_WATCHED_FIELDS: ReadonlySet<string> = new Set([
  'displayName',
  'bio',
  'avatarUrl',
  'website',
  'tradingStrategy',
  'riskLevel',
  'feeRate',
  'minTradeAmount',
  'maxTradeAmount',
  'supportedAssets',
  'tradingPairs',
  'isAcceptingFollowers',
]);

/**
 * A subscriber that has opted in to provider profile change notifications.
 */
export interface ProviderProfileSubscriber {
  userId: string;
  optedIn: boolean;
}

/**
 * A single detected change to a watched provider profile field.
 */
export interface ProviderProfileChange {
  field: string;
  previousValue: unknown;
  newValue: unknown;
}

/**
 * Result of dispatching provider profile change notifications.
 */
export interface ProviderProfileChangeDispatchResult {
  changes: ProviderProfileChange[];
  notified: string[];
  skipped: string[];
  failed: string[];
}

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

  /**
   * In-memory dedupe index of already-dispatched provider profile change
   * events, keyed by provider + field + new value. Prevents duplicate
   * notifications for the same change.
   */
  private readonly dispatchedProfileChanges = new Set<string>();

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
   * Detect important changes between two versions of a provider's public
   * profile / trading configuration. Only watched fields are considered.
   *
   * @param previous The provider profile before the update
   * @param next The provider profile after the update
   * @returns The list of detected changes (empty when nothing relevant changed)
   */
  detectProviderProfileChanges(
    previous: Record<string, any>,
    next: Record<string, any>,
  ): ProviderProfileChange[] {
    const changes: ProviderProfileChange[] = [];

    for (const field of PROVIDER_PROFILE_WATCHED_FIELDS) {
      const previousValue = previous?.[field];
      const newValue = next?.[field];

      if (!this.valuesEqual(previousValue, newValue)) {
        changes.push({ field, previousValue, newValue });
      }
    }

    return changes;
  }

  /**
   * Notify opted-in subscribers about important provider profile changes.
   *
   * - Only subscribers with `optedIn === true` are notified.
   * - Events are deduplicated per provider/field/new value so subscribers do
   *   not receive repeated notifications for the same change.
   * - Delivery failures are logged and reported in the result so they can be
   *   retried; the underlying queue also applies retry/backoff.
   *
   * @param providerId The provider whose profile changed
   * @param previous The provider profile before the update
   * @param next The provider profile after the update
   * @param subscribers The candidate subscribers (opt-in is enforced here)
   * @param channel The delivery channel to use
   * @returns A summary of the dispatch outcome
   */
  async notifyProviderProfileChanges(
    providerId: string,
    previous: Record<string, any>,
    next: Record<string, any>,
    subscribers: ProviderProfileSubscriber[],
    channel: NotificationChannel = NotificationChannel.PUSH,
  ): Promise<ProviderProfileChangeDispatchResult> {
    const result: ProviderProfileChangeDispatchResult = {
      changes: [],
      notified: [],
      skipped: [],
      failed: [],
    };

    const changes = this.detectProviderProfileChanges(previous, next);
    if (changes.length === 0) {
      return result;
    }

    // Deduplicate: drop changes already dispatched for this provider.
    const freshChanges = changes.filter((change) => {
      const key = this.profileChangeKey(providerId, change);
      if (this.dispatchedProfileChanges.has(key)) {
        return false;
      }
      return true;
    });

    result.changes = freshChanges;
    if (freshChanges.length === 0) {
      this.logger.debug(`No new provider profile changes to notify for ${providerId}`);
      return result;
    }

    const optedInSubscribers = (subscribers ?? []).filter((s) => s && s.optedIn === true);
    if (optedInSubscribers.length === 0) {
      this.logger.debug(`No opted-in subscribers for provider ${providerId}`);
      return result;
    }

    const title = 'Provider profile updated';
    const message = this.buildProviderProfileChangeMessage(freshChanges);
    const metadata = {
      providerId,
      changes: freshChanges.map((change) => ({
        field: change.field,
        previousValue: change.previousValue,
        newValue: change.newValue,
      })),
    };

    for (const subscriber of optedInSubscribers) {
      try {
        await this.createAndQueueNotification(
          subscriber.userId,
          NotificationType.PROVIDER_PROFILE_CHANGED,
          title,
          message,
          channel,
          metadata,
        );
        result.notified.push(subscriber.userId);
      } catch (error) {
        // Delivery failures are recorded so they can be retried; the queue
        // retry/backoff abstraction also handles transient provider errors.
        result.failed.push(subscriber.userId);
        this.logger.error(
          `Failed to notify subscriber ${subscriber.userId} of provider ${providerId} profile change: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Only mark changes as dispatched once at least one subscriber was
    // successfully notified, so a total failure remains recoverable.
    if (result.notified.length > 0) {
      for (const change of freshChanges) {
        this.dispatchedProfileChanges.add(this.profileChangeKey(providerId, change));
      }
    }

    return result;
  }

  /**
   * Build a stable dedupe key for a provider profile change event.
   */
  private profileChangeKey(providerId: string, change: ProviderProfileChange): string {
    return `${providerId}:${change.field}:${JSON.stringify(change.newValue ?? null)}`;
  }

  /**
   * Build a human-readable message describing the detected changes.
   */
  private buildProviderProfileChangeMessage(changes: ProviderProfileChange[]): string {
    const fields = changes.map((change) => change.field).join(', ');
    return `Provider profile fields updated: ${fields}`;
  }

  /**
   * Structural equality check used to detect meaningful field changes.
   */
  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
      return true;
    }
    if (a === null || b === null || a === undefined || b === undefined) {
      return false;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }
    return false;
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
