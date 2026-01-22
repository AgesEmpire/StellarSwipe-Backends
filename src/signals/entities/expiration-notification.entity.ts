import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export enum NotificationType {
  EXPIRATION_WARNING = 'EXPIRATION_WARNING',
  GRACE_PERIOD_STARTED = 'GRACE_PERIOD_STARTED',
  POSITION_AUTO_CLOSED = 'POSITION_AUTO_CLOSED',
  SIGNAL_CANCELLED = 'SIGNAL_CANCELLED',
  SIGNAL_EXPIRED = 'SIGNAL_EXPIRED',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  READ = 'READ',
}

export enum NotificationChannel {
  IN_APP = 'IN_APP',
  EMAIL = 'EMAIL',
  PUSH = 'PUSH',
  WEBHOOK = 'WEBHOOK',
}

@Entity('expiration_notifications')
export class ExpirationNotification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'signal_id', type: 'uuid', nullable: true })
  signalId!: string | null;

  @Column({ name: 'position_id', type: 'uuid', nullable: true })
  positionId!: string | null;

  @Column({ type: 'enum', enum: NotificationType })
  type!: NotificationType;

  @Column({ type: 'enum', enum: NotificationStatus, default: NotificationStatus.PENDING })
  status!: NotificationStatus;

  @Column({ type: 'enum', enum: NotificationChannel, default: NotificationChannel.IN_APP })
  channel!: NotificationChannel;

  @Column()
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'jsonb', nullable: true })
  data!: Record<string, unknown> | null;

  @Column({ name: 'sent_at', type: 'timestamp with time zone', nullable: true })
  sentAt!: Date | null;

  @Column({ name: 'read_at', type: 'timestamp with time zone', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}
