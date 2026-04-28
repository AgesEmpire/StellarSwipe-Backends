import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum UserSegment {
  FREE = 'free',
  PRO = 'pro',
  ENTERPRISE = 'enterprise',
  TRIAL = 'trial',
}

export enum UsageEventType {
  VIEW = 'view',
  INTERACT = 'interact',
  COMPLETE = 'complete',
  ERROR = 'error',
  ABANDON = 'abandon',
}

@Entity('feature_usage_events')
@Index(['featureKey', 'occurredAt'])
@Index(['userId', 'featureKey'])
@Index(['userSegment', 'featureKey'])
@Index(['occurredAt'])
export class FeatureUsageEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'feature_key' })
  featureKey: string;

  @Column({ name: 'feature_category', nullable: true })
  featureCategory: string | null;

  @Column({ name: 'user_id' })
  @Index()
  userId: string;

  @Column({
    name: 'user_segment',
    type: 'enum',
    enum: UserSegment,
    default: UserSegment.FREE,
  })
  userSegment: UserSegment;

  @Column({
    name: 'event_type',
    type: 'enum',
    enum: UsageEventType,
    default: UsageEventType.INTERACT,
  })
  eventType: UsageEventType;

  @Column({ name: 'session_id', nullable: true })
  sessionId: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
