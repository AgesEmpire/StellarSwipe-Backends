import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { NotificationDeliveryState } from './notification.entity';

/**
 * One provider delivery receipt event, kept for audit. `(provider, event_id)`
 * is unique so a redelivered provider event is recorded and applied once.
 */
@Index('idx_notification_provider_receipts_event', ['provider', 'eventId'], { unique: true })
@Index('idx_notification_provider_receipts_message', ['externalMessageId'])
@Entity('notification_provider_receipts')
export class NotificationProviderReceipt {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  provider!: string;

  @Column({ name: 'event_id', type: 'varchar', length: 255 })
  eventId!: string;

  @Column({ name: 'external_message_id', type: 'varchar', length: 255, nullable: true })
  externalMessageId!: string | null;

  @Column({ name: 'notification_id', type: 'uuid', nullable: true })
  notificationId!: string | null;

  @Column({ name: 'provider_status', type: 'varchar', length: 100 })
  providerStatus!: string;

  @Column({ name: 'delivery_state', type: 'varchar', length: 20, nullable: true })
  deliveryState!: NotificationDeliveryState | null;

  /** True when this receipt changed the notification's delivery state. */
  @Column({ type: 'boolean', default: false })
  applied!: boolean;

  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  @Column({ name: 'occurred_at', type: 'timestamp with time zone', nullable: true })
  occurredAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
