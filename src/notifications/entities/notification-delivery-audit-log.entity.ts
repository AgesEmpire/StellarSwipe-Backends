import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';
import { NotificationChannel } from './notification.entity';

@Index(['userId', 'createdAt'])
@Entity('notification_delivery_audit_logs')
export class NotificationDeliveryAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'notification_id', type: 'uuid', nullable: true })
  notificationId!: string | null;

  @Column({ name: 'notification_type', length: 100 })
  notificationType!: string;

  @Column({ type: 'enum', enum: NotificationChannel })
  channel!: NotificationChannel;

  @Column({
    name: 'delivered_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  deliveredAt!: Date | null;

  @Column({ name: 'skipped_reason', type: 'text', nullable: true })
  skippedReason!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  /** Set on failed attempts only: whether the failure was transient and may be retried. */
  @Column({ type: 'boolean', default: false })
  retryable!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
