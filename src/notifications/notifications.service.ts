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

/**
 * Persisted record of a user's SMS opt-out state change. Used to enforce
 * opt-out centrally across every SMS dispatch path.
 */
export interface SmsOptOutEvent {
  userId: string;
  optedOut: boolean;
  reason?: string;
  occurredAt: Date;
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

  /**
   * Current SMS opt-out state per user. Consulted by every SMS dispatch path
   * (queued and immediate) so no message is sent after a user opts out.
   */
  private readonly smsOptOutState = new Map<string, boolean>();

  /**
   * Persisted SMS opt-out events, in occurrence order.
   */
  private readonly smsOptOutEvents: SmsOptOutEvent[] = [];

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
  ) {}

  /**
   * Record and persist an SMS opt-out (or opt-in) event for a user. The
   * latest event determines the current preference consulted by all SMS
   * dispatch paths.
   *
   * @param userId The user whose SMS preference changed
   * @param optedOut Whether the user has opted out of SMS
   * @param reason Optional reason for the change
   * @returns The persisted opt-out event
   */
  async recordSmsOptOut(
    userId: string,
    optedOut: boolean,
    reason?: string,
  ): Promise<SmsOptOutEvent> {
    const event: SmsOptOutEvent = {
      userId,
      optedOut,
      reason,
      occurredAt: new Date(),
    };

    this.smsOptOutEvents.push(event);
    this.smsOptOutState.set(userId, optedOut);

    this.logger.log(
      `Persisted SMS ${optedOut ? 'opt-out' : 'opt-in'} event for user ${userId}`,
    );

    return event;
  }

  /**
   * Whether the user is currently opted out of SMS. Defaults to opted-in
   * when no preference has been recorded.
   */
  isSmsOptedOut(userId: string): boolean {
    return this.smsOptOutState.get(userId) === true;
  }

  /**
   * Return the persisted SMS opt-out events for a user (most recent last).
   */
  getSmsOptOutEvents(userId: string): SmsOptOutEvent[] {
    return this.smsOptOutEvents.filter((event) => event.userId === userId);
  }

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

    // Enforce SMS opt-out centrally before any queued SMS dispatch.
    if (channel === NotificationChannel.SMS && this.isSmsOptedOut(userId)) {
      this.logger.warn(
        `Skipping queued SMS notification for opted-out user ${userId}`,
      );
      throw new ForbiddenException('User has opted out of SMS notifications');
    }

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
   * Immediately dispatch an SMS notification, consulting the current opt-out
   * preference before sending.
   *
   * @param userId The user ID to send the SMS to
   * @param type The type of notification
   * @param title The notification title
   * @param message The notification message
   * @param metadata Additional data to include with the notification
   * @returns The created notification record
   */
  async sendSmsNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    metadata: Record<string, any> = {},
  ): Promise<Notification> {
    if (this.isSmsOptedOut(userId)) {
      this.logger.warn(
        `Skipping immediate SMS notification for opted-out user ${userId}`,
      );
      throw new ForbiddenException('User has opted out of SMS notifications');
    }

    const notification = this.notificationRepository.create({
      userId,
      type,
      title,
      message,
      channel: NotificationChannel.SMS,
      metadata,
      status: 'PENDING',
    });

    const savedNotification = await this.notificationRepository.save(notification);
    this.logger.log(`Dispatched immediate SMS notification ${savedNotification.id}`);
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

    for (const subscriber of optedInSubscribers) {
      // Enforce SMS opt-out centrally for provider profile dispatches too.
      if (channel === NotificationChannel.SMS && this.isSmsOptedOut(subscriber.userId)) {
        result.skipped.push(subscriber.userId);
        continue;
      }

      try {
        await this.createAndQueueNotification(
          subscriber.userId,
          NotificationType.PROVIDER_PROFILE_CHANGED,
          `Provider ${providerId} updated`,
          `Provider ${providerId} changed ${freshChanges.map((c) => c.field).join(', ')}`,
          channel,
          { providerId, changes: freshChanges },
        );
        result.notified.push(subscriber.userId);
      } catch (error) {
        this.logger.error(
          `Failed to notify subscriber ${subscriber.userId} of provider ${providerId} changes`,
          error instanceof Error ? error.stack : undefined,
        );
        result.failed.push(subscriber.userId);
      }
    }

    for (const change of freshChanges) {
      this.dispatchedProfileChanges.add(this.profileChangeKey(providerId, change));
    }

    return result;
  }

  private profileChangeKey(providerId: string, change: ProviderProfileChange): string {
    return `${providerId}:${change.field}:${JSON.stringify(change.newValue)}`;
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
