import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('provider_stats')
@Index(['providerId'], { name: 'idx_provider_stats_provider' })
@Index(['reputation_score'], { name: 'idx_provider_stats_reputation' })
export class ProviderStats {
  @PrimaryColumn({ name: 'provider_id', type: 'uuid' })
  providerId!: string;

  @Column({ name: 'total_signals', type: 'int', default: 0 })
  totalSignals!: number;

  @Column({ name: 'active_signals', type: 'int', default: 0 })
  activeSignals!: number;

  @Column({ name: 'closed_signals', type: 'int', default: 0 })
  closedSignals!: number;

  @Column({ name: 'successful_signals', type: 'int', default: 0 })
  successfulSignals!: number;

  @Column({ name: 'failed_signals', type: 'int', default: 0 })
  failedSignals!: number;

  @Column({ name: 'expired_signals', type: 'int', default: 0 })
  expiredSignals!: number;

  @Column({
    name: 'best_signal_pnl',
    type: 'decimal',
    precision: 10,
    scale: 4,
    default: '0',
  })
  bestSignalPnl!: string;

  @Column({
    name: 'worst_signal_pnl',
    type: 'decimal',
    precision: 10,
    scale: 4,
    default: '0',
  })
  worstSignalPnl!: string;

  @Column({
    name: 'max_drawdown',
    type: 'decimal',
    precision: 10,
    scale: 4,
    default: '0',
  })
  maxDrawdown!: string;

  @Column({ name: 'average_hold_time_seconds', type: 'int', default: 0 })
  averageHoldTimeSeconds!: number;

  @Column({
    name: 'total_pnl',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: '0',
  })
  totalPnl!: string;

  @Column({
    name: 'average_pnl',
    type: 'decimal',
    precision: 10,
    scale: 4,
    default: '0',
  })
  averagePnl!: string;

  @Column({
    name: 'win_rate',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: '0',
  })
  winRate!: string;

  @Column({ name: 'total_copiers', type: 'int', default: 0 })
  totalCopiers!: number;

  @Column({
    name: 'total_volume_copied',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: '0',
  })
  totalVolumeCopied!: string;

  @Column({ name: 'streak_wins', type: 'int', default: 0 })
  streakWins!: number;

  @Column({ name: 'streak_losses', type: 'int', default: 0 })
  streakLosses!: number;

  @Column({
    name: 'reputation_score',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: '50',
  })
  reputationScore!: string;

  @Column({
    name: 'last_signal_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  lastSignalAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt?: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt?: Date;
}
