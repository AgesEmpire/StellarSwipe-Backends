import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum DecayCurveType {
  EXPONENTIAL = 'exponential',
  LINEAR = 'linear',
  LOGARITHMIC = 'logarithmic',
  POWER = 'power',
}

export enum DecayStatus {
  ACTIVE = 'active',
  DEGRADED = 'degraded',
  EXPIRED = 'expired',
}

@Entity('signal_decay')
@Index(['signalId', 'analyzedAt'])
@Index(['signalType', 'status'])
export class SignalDecay {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'signal_id' })
  @Index()
  signalId: string;

  @Column({ name: 'signal_type' })
  signalType: string;

  @Column({
    name: 'decay_curve_type',
    type: 'enum',
    enum: DecayCurveType,
    default: DecayCurveType.EXPONENTIAL,
  })
  decayCurveType: DecayCurveType;

  @Column({
    type: 'enum',
    enum: DecayStatus,
    default: DecayStatus.ACTIVE,
  })
  status: DecayStatus;

  @Column({ name: 'initial_accuracy', type: 'decimal', precision: 5, scale: 4 })
  initialAccuracy: number;

  @Column({ name: 'current_accuracy', type: 'decimal', precision: 5, scale: 4 })
  currentAccuracy: number;

  @Column({ name: 'decay_rate', type: 'decimal', precision: 8, scale: 6 })
  decayRate: number;

  @Column({ name: 'half_life_hours', type: 'decimal', precision: 10, scale: 4 })
  halfLifeHours: number;

  @Column({
    name: 'optimal_entry_window_start',
    type: 'decimal',
    precision: 10,
    scale: 4,
    nullable: true,
  })
  optimalEntryWindowStart: number | null;

  @Column({
    name: 'optimal_entry_window_end',
    type: 'decimal',
    precision: 10,
    scale: 4,
    nullable: true,
  })
  optimalEntryWindowEnd: number | null;

  @Column({
    name: 'recommended_expiry_hours',
    type: 'decimal',
    precision: 10,
    scale: 4,
  })
  recommendedExpiryHours: number;

  @Column({ name: 'sample_count', type: 'int', default: 0 })
  sampleCount: number;

  @Column({
    name: 'r_squared',
    type: 'decimal',
    precision: 5,
    scale: 4,
    nullable: true,
  })
  rSquared: number | null;

  @Column({ name: 'curve_parameters', type: 'jsonb', nullable: true })
  curveParameters: Record<string, number> | null;

  @Column({ name: 'performance_by_hour', type: 'jsonb', nullable: true })
  performanceByHour: Record<string, number> | null;

  @Column({ name: 'volatility_adjusted', type: 'boolean', default: false })
  volatilityAdjusted: boolean;

  @Column({
    name: 'market_regime',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  marketRegime: string | null;

  @Column({ name: 'analyzed_at', type: 'timestamptz' })
  analyzedAt: Date;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
