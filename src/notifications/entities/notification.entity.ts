import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum NotificationChannel {
  EMAIL = 'email',
  IN_APP = 'in_app',
  PUSH = 'push',
  BOTH = 'both',
}

export enum NotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  READ = 'read',
}

/**
 * Delivery urgency. LOW-priority in-app notifications are batched into a
 * scheduled digest instead of being delivered immediately; URGENT
 * notifications always go out right away.
 */
export enum NotificationPriority {
  URGENT = 'urgent',
  LOW = 'low',
}

export enum NotificationType {
  TRADE_EXECUTED = 'TRADE_EXECUTED',
  TRADE_CLOSED = 'TRADE_CLOSED',
  TRADE_PENDING = 'TRADE_PENDING',
  TRADE_CANCELLED = 'TRADE_CANCELLED',
  TRADE_FAILED = 'TRADE_FAILED',
  KYC_SUBMITTED = 'KYC_SUBMITTED',
  KYC_REJECTED = 'KYC_REJECTED',
  SIGNAL_CREATED = 'SIGNAL_CREATED',
  SIGNAL_UPDATED = 'SIGNAL_UPDATED',
  SIGNAL_CLOSED = 'SIGNAL_CLOSED',
  RISK_ALERT = 'RISK_ALERT',
  PRICE_ALERT = 'PRICE_ALERT',
  LOW_BALANCE = 'LOW_BALANCE',
  SYSTEM = 'SYSTEM',
  MARKETING = 'MARKETING',
}

/**
 * Notification types subject to marketing consent (GDPR/CAN-SPAM opt-out).
 * Everything else — trade confirmations, security/system alerts, etc. — is
 * mandatory and always delivered regardless of marketing consent state.
 */
export const CONSENT_GATED_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  NotificationType.MARKETING,
]);

/**
 * Notification types that are not time-sensitive and are eligible to be
 * batched into a scheduled digest rather than delivered immediately.
 * Everything else (trade lifecycle, KYC, risk/balance alerts) is urgent
 * and is always delivered right away.
 */
export const LOW_PRIORITY_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  NotificationType.SIGNAL_CREATED,
  NotificationType.SIGNAL_UPDATED,
  NotificationType.SIGNAL_CLOSED,
  NotificationType.PRICE_ALERT,
  NotificationType.MARKETING,
]);

export function resolveNotificationPriority(type: string): NotificationPriority {
  return LOW_PRIORITY_NOTIFICATION_TYPES.has(type)
    ? NotificationPriority.LOW
    : NotificationPriority.URGENT;
}

@Index('idx_notifications_user_id', ['userId'])
@Index('idx_notifications_user_read', ['userId', 'status'])
@Index('idx_notifications_event_id', ['eventId'], { unique: true, where: '"event_id" IS NOT NULL' })
@Index('idx_notifications_digest_lookup', ['userId', 'priority', 'digestedAt'])
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ length: 100 })
  type!: string;

  @Column({
    type: 'enum',
    enum: NotificationChannel,
    default: NotificationChannel.IN_APP,
  })
  channel!: NotificationChannel;

  @Column({ length: 255 })
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: NotificationStatus,
    default: NotificationStatus.PENDING,
  })
  status!: NotificationStatus;

  @Column({ name: 'sent_at', type: 'timestamp', nullable: true })
  sentAt?: Date;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'read_at', type: 'timestamp', nullable: true })
  readAt?: Date;

  /**
   * Stable identifier of the domain event that produced this notification
   * (e.g. `trade.failed:<tradeId>:<correlationId>`). A unique index on this
   * column lets retried event handlers safely re-attempt notification
   * creation without producing a duplicate inbox item: the duplicate
   * insert is rejected at the database level and the existing row is
   * reused instead.
   */
  @Column({ name: 'event_id', type: 'varchar', length: 255, nullable: true })
  eventId?: string | null;

  @Column({
    type: 'varchar',
    length: 20,
    default: NotificationPriority.URGENT,
  })
  priority!: NotificationPriority;

  /**
   * Set when this notification was folded into a scheduled digest instead
   * of (or in addition to) being delivered on its own, so it is never
   * delivered a second time by a later digest run.
   */
  @Column({ name: 'digested_at', type: 'timestamp', nullable: true })
  digestedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
