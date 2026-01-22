 feat/ai-signal-validation-integration
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

export enum SignalStatus {
  PENDING = "PENDING",
  VALIDATED = "VALIDATED",
  REJECTED = "REJECTED",
  FAILED = "FAILED",
}

@Entity("signals")
export class Signal {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  assetPair!: string;

  @Column()
  action!: string; // e.g., BUY, SELL

  @Column("text")
  rationale!: string;

  @Column({ type: "int", nullable: true })
  validationScore!: number;

  @Column({
    type: "enum",
    enum: SignalStatus,
    default: SignalStatus.PENDING,
  })
  status!: SignalStatus;

  @Column({ type: "text", nullable: true })
  validationFeedback!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
 feat/signal-autoclose
  OneToMany,
} from 'typeorm';
import { CopiedPosition } from './copied-position.entity';

export enum SignalStatus {
  ACTIVE = 'ACTIVE',
  CLOSED = 'CLOSED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum SignalType {

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
 main
  BUY = 'BUY',
  SELL = 'SELL',
}

 feat/signal-autoclose
export enum SignalOutcome {
  PENDING = 'PENDING',
  TARGET_HIT = 'TARGET_HIT',
  STOP_LOSS_HIT = 'STOP_LOSS_HIT',
  EXPIRED = 'EXPIRED',
  MANUALLY_CLOSED = 'MANUALLY_CLOSED',
  CANCELLED = 'CANCELLED',
}

@Entity('signals')

export enum SignalStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CLOSED = 'CLOSED',
}

@Entity('signals')
@Index(['status', 'created_at'])
 main
 main
export class Signal {
  @PrimaryGeneratedColumn('uuid')
  id!: string;
 feat/signal-autoclose
  @Column({ name: 'provider_id' })
  providerId!: string;

  @Column({ name: 'base_asset' })
  baseAsset!: string;

  @Column({ name: 'counter_asset' })
  counterAsset!: string;

  @Column({ type: 'enum', enum: SignalType })
  type!: SignalType;

  @Column({ type: 'enum', enum: SignalStatus, default: SignalStatus.ACTIVE })
  status!: SignalStatus;

  @Column({ type: 'enum', enum: SignalOutcome, default: SignalOutcome.PENDING })

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
 main
  outcome!: SignalOutcome;

  @Column({ name: 'entry_price', type: 'decimal', precision: 18, scale: 8 })
  entryPrice!: string;

  @Column({ name: 'target_price', type: 'decimal', precision: 18, scale: 8 })
  targetPrice!: string;

 feat/signal-autoclose
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

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  @OneToMany(() => CopiedPosition, (position) => position.signal)
  copiedPositions!: CopiedPosition[];

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
 main
 main
}
