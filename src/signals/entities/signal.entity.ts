import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
 feat/signal-performance
  Index,
  OneToMany,
} from 'typeorm';
import { SignalPerformance } from './signal-performance.entity';

export enum SignalStatus {
  ACTIVE = 'active',
  CLOSED = 'closed',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export enum SignalType {
  BUY = 'buy',
  SELL = 'sell',
}

export enum SignalOutcome {
  PENDING = 'pending',
  TARGET_HIT = 'target_hit',
  STOP_LOSS_HIT = 'stop_loss_hit',
  EXPIRED = 'expired',
  MANUALLY_CLOSED = 'manually_closed',
}

@Entity('signals')
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum SignalAction {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum SignalStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CLOSED = 'CLOSED',
}

@Entity('signals')
@Index(['status', 'created_at'])
 main
export class Signal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

 feat/signal-performance
  @Column({ name: 'provider_id', type: 'uuid' })
  @Index()
  providerId!: string;

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

  @Column()
  provider_id!: string;

  @ManyToOne(() => User, (user) => user.signals)
  @JoinColumn({ name: 'provider_id' })
  provider!: User;

  @Column()
  asset_pair!: string;

  @Column({
    type: 'enum',
    enum: SignalAction,
  })
  action!: SignalAction;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  entry_price!: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  target_price!: number;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  stop_loss!: number;

  @Column({ type: 'text' })
  rationale!: string;

  @Column({ type: 'int', default: 50 })
  confidence_score!: number;
 main

  @Column({
    type: 'enum',
    enum: SignalStatus,
    default: SignalStatus.ACTIVE,
  })
 feat/signal-performance
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

  @Column({ name: 'stop_loss_price', type: 'decimal', precision: 18, scale: 8 })
  stopLossPrice!: string;

  @Column({ name: 'current_price', type: 'decimal', precision: 18, scale: 8, nullable: true })
  currentPrice?: string;

  @Column({ name: 'close_price', type: 'decimal', precision: 18, scale: 8, nullable: true })
  closePrice?: string;

  @Column({ name: 'copiers_count', default: 0 })
  copiersCount!: number;

  @Column({ name: 'total_copied_volume', type: 'decimal', precision: 18, scale: 8, default: '0' })
  totalCopiedVolume!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ name: 'expires_at', type: 'timestamp' })
  @Index()
  expiresAt!: Date;

  @Column({ name: 'closed_at', type: 'timestamp', nullable: true })
  closedAt?: Date;

  @OneToMany(() => SignalPerformance, (performance) => performance.signal)
  performanceHistory!: SignalPerformance[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  status!: SignalStatus;

  @Column({ type: 'int', default: 0 })
  executed_count!: number;

  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0 })
  total_profit_loss!: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  success_rate!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @Column({ type: 'timestamp' })
  expires_at!: Date;

  @DeleteDateColumn()
  deleted_at?: Date;
 main
}
