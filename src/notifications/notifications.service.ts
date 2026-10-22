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
 * Maximum number of outbound notification frames buffered per WebSocket
 * client. Once a slow client's buffer reaches this bound, further frames are
 * dropped and the client is disconnected so memory use stays bounded.
 */
const MAX_WS_BUFFERED_FRAMES = 100;

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

/**
 * Minimal outbound WebSocket client surface required for backpressure. A
 * client is considered saturated when its buffered amount exceeds the
 * configured bound.
 */
export interface NotificationWebSocketClient {
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/**
 * Outcome of attempting to deliver a notification frame to a WebSocket client.
 */
export type WebSocketDeliveryOutcome = 'sent' | 'dropped' | 'disconnected';

/**
 * Filters accepted by the inbox unread count endpoint. Mirrors the filtering
 * supported by the inbox listing API so counts stay consistent with it.
 */
export interface UnreadCountFilters {
  type?: NotificationType;
  channel?: NotificationChannel;
}

/**
 * Result of an unread notification count query.
 */
export interface UnreadCountResult {
  unreadCount: number;
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

  /**
   * Per-client outbound frame buffer used to bound WebSocket memory use.
   * Keyed by client identity; each entry holds the frames awaiting flush.
   */
  private readonly wsOutboundBuffers = new Map<
    NotificationWebSocketClient,
    string[]
  >();

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectQueue(NOTIFICATION_QUEUE)
    private readonly notificationQueue: Queue,
  ) {}

  /**
   * Count the unread notifications for the authenticated user. The unread
   * definition matches the inbox API (read state is `isRead === false`), and
   * the query is always scoped to the requesting user so one user can never
   * observe another user's unread count.
   *
   * @param userId The authenticated user requesting the count
   * @param filters Optional filters consistent with the inbox API
   * @returns The unread count for the user
   */
  async getUnreadCount(
    userId: string,
    filters: UnreadCountFilters = {},
  ): Promise<UnreadCountResult> {
    if (!userId) {
      throw new ForbiddenException('A user is required to count notifications');
    }

    const where: Record<string, unknown> = {
      userId,
      isRead: false,
    };

    if (filters.type !== undefined) {
      where.type = filters.type;
    }
    if (filters.channel !== undefined) {
      where.channel = filters.channel;
    }

    const unreadCount = await this.notificationRepository.count({ where });
    return { unreadCount };
  }

  /**
   * Deliver a notification frame to a WebSocket client with bounded
   * buffering. Slow clients that cannot keep up have frames dropped once the
   * per-client buffer is saturated, and are disconnected predictably rather
   * than allowing unbounded memory growth.
   *
   * @param client The target WebSocket client
   * @param frame The serialized notification frame
   * @returns The delivery outcome for observability and testing
   */
  deliverToWebSocket(
    client: NotificationWebSocketClient,
    frame: string,
  ): WebSocketDeliveryOutcome {
    const buffer = this.wsOutboundBuffers.get(client) ?? [];

    // Saturated: drop the frame and disconnect the slow client.
    if (
      buffer.length >= MAX_WS_BUFFERED_FRAMES ||
      client.bufferedAmount >= MAX_WS_BUFFERED_FRAMES
    ) {
      this.wsOutboundBuffers.delete(client);
      this.logger.warn(
        `WebSocket client saturated (buffered=${buffer.length}); dropping frame and disconnecting`,
      );
      try {
        client.close(1013, 'Notification buffer overflow');
      } catch (error) {
        this.logger.warn(
          `Failed to close saturated WebSocket client: ${(error as Error).message}`,
        );
      }
      return 'disconnected';
    }

    try {
      client.send(frame);
    } catch (error) {
      this.wsOutboundBuffers.delete(client);
      this.logger.warn(
        `Failed to send WebSocket frame: ${(error as Error).message}`,
      );
      return 'dropped';
    }

    // Track the frame until the client drains its buffer.
    buffer.push(frame);
    this.wsOutboundBuffers.set(client, buffer);
    return 'sent';
  }

  /**
   * Release buffered frames for a client once it has drained, or when it
   * disconnects. Keeps the per-client buffer from growing without bound.
   */
  releaseWebSocketBuffer(client: NotificationWebSocketClient): void {
    this.wsOutboundBuffers.delete(client);
  }

  /**
   * Number of frames currently buffered for a client. Exposed for tests and
   * operational visibility into slow-client behavior.
   */
  getWebSocketBufferedCount(client: NotificationWebSocketClient): number {
    return this.wsOutboundBuffers.get(client)?.length ?? 0;
  }

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
  ): Promise<