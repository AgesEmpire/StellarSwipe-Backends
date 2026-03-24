import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum ScheduleType {
  TIME = 'time',
  PRICE = 'price',
  RECURRING = 'recurring',
}

export enum ScheduleStatus {
  PENDING = 'pending',
  EXECUTED = 'executed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export enum PriceConditionType {
  ABOVE = 'above',
  BELOW = 'below',
}

export enum RecurrenceType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
}

export interface ScheduleConditions {
  executeAt?: Date;
  targetPrice?: number;
  priceCondition?: PriceConditionType;
  recurrence?: RecurrenceType;
  recurTime?: string;
}

@Entity('scheduled_trades')
@Index(['userId', 'status'])
export class ScheduledTrade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'signal_id', nullable: true })
  signalId?: string;

  @Column({ name: 'asset_pair', length: 50 })
  assetPair!: string;

  @Column({ name: 'schedule_type', type: 'enum', enum: ScheduleType })
  scheduleType!: ScheduleType;

  @Column({ type: 'jsonb' })
  conditions!: ScheduleConditions;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  amount!: number;

  @Column({
    type: 'enum',
    enum: ScheduleStatus,
    default: ScheduleStatus.PENDING,
  })
  status!: ScheduleStatus;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ name: 'retry_count', default: 0 })
  retryCount!: number;

  @Column({ name: 'max_retries', default: 3 })
  maxRetries!: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string;

  @Column({ name: 'executed_at', type: 'timestamp', nullable: true })
  executedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
