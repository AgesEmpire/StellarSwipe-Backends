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

  // Quiet hours: suppress non-critical notifications between start and end (HH:mm, in `timezone`)
  @Column({ name: 'quiet_hours_enabled', default: false })
  quietHoursEnabled: boolean;

  @Column({ name: 'quiet_hours_start', type: 'varchar', length: 5, nullable: true })
  quietHoursStart?: string;

  @Column({ name: 'quiet_hours_end', type: 'varchar', length: 5, nullable: true })
  quietHoursEnd?: string;

  @Column({ name: 'timezone', default: 'UTC' })
  timezone: string;

  // Per-type minimum thresholds (e.g. minimum signal score) below which a notification is suppressed
  @Column({ name: 'thresholds', type: 'jsonb', nullable: true })
  thresholds?: Partial<Record<'tradeUpdates' | 'signalPerformance' | 'systemAlerts' | 'marketing', number>>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
