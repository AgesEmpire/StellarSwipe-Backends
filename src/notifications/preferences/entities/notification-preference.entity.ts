import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('user_notification_preferences')
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ name: 'user_id' })
  userId: string;

  // Trade updates
  @Column({ name: 'trade_updates_email', default: true })
  tradeUpdatesEmail: boolean;

  @Column({ name: 'trade_updates_push', default: true })
  tradeUpdatesPush: boolean;

  // Signal performance
  @Column({ name: 'signal_performance_email', default: true })
  signalPerformanceEmail: boolean;

  @Column({ name: 'signal_performance_push', default: true })
  signalPerformancePush: boolean;

  // System alerts
  @Column({ name: 'system_alerts_email', default: true })
  systemAlertsEmail: boolean;

  @Column({ name: 'system_alerts_push', default: true })
  systemAlertsPush: boolean;

  // Marketing
  @Column({ name: 'marketing_email', default: false })
  marketingEmail: boolean;

  @Column({ name: 'marketing_push', default: false })
  marketingPush: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
