import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { CopiedPosition } from './copied-position.entity';

export enum SignalType {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum SignalStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum SignalOutcome {
  PENDING = 'PENDING',
  TARGET_HIT = 'TARGET_HIT',
  STOP_LOSS_HIT = 'STOP_LOSS_HIT',
  EXPIRED = 'EXPIRED',
  MANUALLY_CLOSED = 'MANUALLY_CLOSED',
  CANCELLED = 'CANCELLED',
}

@Entity('signals')
@Index(['status', 'created_at'], { name: 'idx_signals_feed' })
@Index(['provider_id', 'created_at'], { name: 'idx_signals_provider' })
@Index(['base_asset', 'counter_asset'])
@Index(['status', 'type'], { name: 'idx_signals_status_type' })
export class Signal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  @Index()
  providerId!: string;

  @ManyToOne(() => User, (user) => user.signals)
  @JoinColumn({ name: 'provider_id' })
  provider!: User;

  @Column({ name: 'base_asset', length: 100 })
  @Index()
  baseAsset!: string;

  @Column({ name: 'counter_asset', length: 100 })
  @Index()
  counterAsset!: string;

  @Column({
    type: 'enum',
    enum: SignalType,
  })
  type!: SignalType;

  @Column({
    type: 'enum',
    enum: SignalStatus,
    default: SignalStatus.ACTIVE,
  })
  @Index()
  status!: SignalStatus;

  @Column({
    type: 'enum',
    enum: SignalOutcome,
    default: SignalOutcome.PENDING,
  })
  outcome!: SignalOutcome;

  @Column({ name: 'entry_price', type: 'decimal', precision: 18, scale: 8 })
  entryPrice!: string;

  @Column({ name: 'target_price', type: 'decimal', precision: 18, scale: 8 })
  targetPrice!: string;

  @Column({
    name: 'stop_loss_price',
    type: 'decimal',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  stopLossPrice!: string | null;

  @Column({
    name: 'current_price',
    type: 'decimal',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  currentPrice!: string | null;

  @Column({
    name: 'close_price',
    type: 'decimal',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  closePrice!: string | null;

  @Column({ name: 'copiers_count', type: 'int', default: 0 })
  copiersCount!: number;

  @Column({
    name: 'total_copied_volume',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: '0',
  })
  totalCopiedVolume!: string;

  @Column({ name: 'expires_at', type: 'timestamp with time zone' })
  @Index()
  expiresAt!: Date;

  @Column({
    name: 'grace_period_ends_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  gracePeriodEndsAt!: Date | null;

  @Column({
    name: 'closed_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  closedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  rationale!: string | null;

  @Column({ type: 'int', default: 50 })
  confidenceScore!: number;

  @Column({ type: 'int', default: 0 })
  executedCount!: number;

  @Column({
    name: 'total_profit_loss',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: '0',
  })
  totalProfitLoss!: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  successRate!: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  @Index()
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  @DeleteDateColumn({
    name: 'deleted_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  deletedAt!: Date | null;

  @OneToMany(() => CopiedPosition, (p) => p.signalId)
  copiedPositions?: CopiedPosition[];
  getAssetPair(): string {
    return `${this.baseAsset}/${this.counterAsset}`;
  }
}
