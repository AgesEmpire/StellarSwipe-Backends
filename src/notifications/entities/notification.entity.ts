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

export enum NotificationType {
  TRADE_EXECUTED = 'TRADE_EXECUTED',
  TRADE_CLOSED = 'TRADE_CLOSED',
  TRADE_PENDING = 'TRADE_PENDING',
  TRADE_CANCELLED = 'TRADE_CANCELLED',
  SIGNAL_CREATED = 'SIGNAL_CREATED',
  SIGNAL_UPDATED = 'SIGNAL_UPDATED',
  SIGNAL_CLOSED = 'SIGNAL_CLOSED',
  RISK_ALERT = 'RISK_ALERT',
  PRICE_ALERT = 'PRICE_ALERT',
  LOW_BALANCE = 'LOW_BALANCE',
  SYSTEM = 'SYSTEM',
}

@Index('idx_notifications_user_id', ['userId'])
@Index('idx_notifications_user_read', ['userId', 'status'])
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
