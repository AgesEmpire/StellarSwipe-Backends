import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Signal Performance Entity
 *
 * Tracks daily performance metrics for signal providers.
 * Used for leaderboards and performance analytics.
 */
@Entity('signal_performance')
@Index(['providerId', 'date'], { name: 'idx_performance_provider_date' })
@Index(['date'], { name: 'idx_performance_date' })
export class SignalPerformance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  @Index()
  providerId!: string;

  @Column({ name: 'date', type: 'date' })
  @Index()
  date!: Date;

  // Signal counts
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

  // Performance metrics
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

  // Volume metrics
  @Column({
    name: 'total_volume',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: '0',
  })
  totalVolume!: string;

  @Column({ name: 'total_copiers', type: 'int', default: 0 })
  totalCopiers!: number;

  @Column({ name: 'new_copiers', type: 'int', default: 0 })
  newCopiers!: number;

  @Column({ name: 'lost_copiers', type: 'int', default: 0 })
  lostCopiers!: number;

  // Timing metrics
  @Column({ name: 'average_hold_time_seconds', type: 'int', default: 0 })
  averageHoldTimeSeconds!: number;

  // Reputation
  @Column({
    name: 'reputation_score',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: '50',
  })
  reputationScore!: string;

  // Rankings
  @Column({ name: 'rank_pnl', type: 'int', nullable: true })
  rankPnl?: number;

  @Column({ name: 'rank_win_rate', type: 'int', nullable: true })
  rankWinRate?: number;

  @Column({ name: 'rank_volume', type: 'int', nullable: true })
  rankVolume?: number;

  @Column({ name: 'rank_overall', type: 'int', nullable: true })
  rankOverall?: number;

  // Metadata
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
