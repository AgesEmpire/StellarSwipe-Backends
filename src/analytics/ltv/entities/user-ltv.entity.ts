import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('user_ltv')
@Index(['userId'], { unique: true })
export class UserLtv {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'predicted_ltv', type: 'float', default: 0 })
  predictedLtv!: number;

  @Column({ name: 'historical_ltv', type: 'float', default: 0 })
  historicalLtv!: number;

  @Column({ name: 'cohort_ltv', type: 'float', default: 0 })
  cohortLtv!: number;

  @Column({ name: 'subscription_tier', default: 'free' })
  subscriptionTier!: string;

  @Column({ name: 'forecast_months', type: 'int', default: 12 })
  forecastMonths!: number;

  @Column({ type: 'float', default: 0 })
  confidence!: number;

  @Column({ default: 'low' })
  segment!: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
