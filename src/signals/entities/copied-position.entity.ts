import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Signal } from './signal.entity';

export enum PositionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  AUTO_CLOSED = 'AUTO_CLOSED',
  MANUALLY_CLOSED = 'MANUALLY_CLOSED',
}

export enum AutoCloseReason {
  SIGNAL_EXPIRED = 'SIGNAL_EXPIRED',
  SIGNAL_CANCELLED = 'SIGNAL_CANCELLED',
  TARGET_HIT = 'TARGET_HIT',
  STOP_LOSS_HIT = 'STOP_LOSS_HIT',
  GRACE_PERIOD_ENDED = 'GRACE_PERIOD_ENDED',
  USER_MANUAL = 'USER_MANUAL',
}

@Entity('copied_positions')
export class CopiedPosition {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'signal_id' })
  signalId!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'stellar_address' })
  stellarAddress!: string;

  @Column({ type: 'enum', enum: PositionStatus, default: PositionStatus.OPEN })
  status!: PositionStatus;

  @Column({
    name: 'auto_close_reason',
    type: 'enum',
    enum: AutoCloseReason,
    nullable: true,
  })
  autoCloseReason!: AutoCloseReason | null;

  @Column({ name: 'entry_price', type: 'decimal', precision: 18, scale: 8 })
  entryPrice!: string;

  @Column({
    name: 'exit_price',
    type: 'decimal',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  exitPrice!: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  volume!: string;

  @Column({
    name: 'pnl_percentage',
    type: 'decimal',
    precision: 10,
    scale: 4,
    nullable: true,
  })
  pnlPercentage!: string | null;

  @Column({
    name: 'pnl_absolute',
    type: 'decimal',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  pnlAbsolute!: string | null;

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

  @ManyToOne(() => Signal, (signal) => signal.copiedPositions)
  @JoinColumn({ name: 'signal_id' })
  signal!: Signal;
}
