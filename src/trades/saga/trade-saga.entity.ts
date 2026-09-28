import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum SagaStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  COMPENSATING = 'compensating',
  COMPENSATED = 'compensated',
  FAILED_TO_COMPENSATE = 'failed_to_compensate',
}

export enum SagaStepStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  COMPENSATED = 'compensated',
  FAILED = 'failed',
}

export interface SagaStepRecord {
  step: string;
  status: SagaStepStatus;
  completedAt?: string;
  compensatedAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

@Index('idx_trade_saga_trade_id', ['tradeId'])
@Index('idx_trade_saga_status', ['status'])
@Entity('trade_sagas')
export class TradeSagaEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The trade this saga is driving; nullable until the trade record is created */
  @Column({ name: 'trade_id', type: 'uuid', nullable: true })
  tradeId?: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'trace_id', type: 'varchar', length: 64 })
  traceId!: string;

  @Column({
    type: 'enum',
    enum: SagaStatus,
    default: SagaStatus.RUNNING,
  })
  status!: SagaStatus;

  /** Ordered list of completed + compensated step records (jsonb) */
  @Column({ type: 'jsonb', default: [] })
  steps!: SagaStepRecord[];

  /** Human-readable final outcome message */
  @Column({ name: 'outcome_message', type: 'text', nullable: true })
  outcomeMessage?: string;

  /** Full serialised payload for audit / replay */
  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
