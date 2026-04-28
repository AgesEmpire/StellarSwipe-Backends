import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { UserSegment } from './feature-usage.entity';

export enum AdoptionStage {
  AWARENESS = 'awareness', // user has seen the feature
  ACTIVATION = 'activation', // user has tried the feature once
  HABIT = 'habit', // user uses it regularly (>=3 times)
  CHAMPION = 'champion', // power user (>=10 times in period)
  CHURNED = 'churned', // used to use, no activity in 30+ days
}

@Entity('feature_adoption')
@Index(['featureKey', 'periodDate', 'userSegment'], { unique: true })
@Index(['featureKey', 'periodDate'])
export class FeatureAdoption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'feature_key' })
  featureKey: string;

  @Column({ name: 'feature_category', nullable: true })
  featureCategory: string | null;

  @Column({ name: 'period_date', type: 'date' })
  periodDate: string;

  @Column({
    name: 'user_segment',
    type: 'enum',
    enum: UserSegment,
    nullable: true,
  })
  userSegment: UserSegment | null;

  @Column({ name: 'total_events', type: 'int', default: 0 })
  totalEvents: number;

  @Column({ name: 'unique_users', type: 'int', default: 0 })
  uniqueUsers: number;

  @Column({ name: 'new_users', type: 'int', default: 0 })
  newUsers: number;

  @Column({ name: 'returning_users', type: 'int', default: 0 })
  returningUsers: number;

  @Column({
    name: 'adoption_rate',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0,
  })
  adoptionRate: number;

  @Column({
    name: 'retention_rate',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0,
  })
  retentionRate: number;

  @Column({
    name: 'avg_duration_ms',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  avgDurationMs: number | null;

  @Column({
    name: 'error_rate',
    type: 'decimal',
    precision: 5,
    scale: 4,
    default: 0,
  })
  errorRate: number;

  @Column({ name: 'stage_breakdown', type: 'jsonb', nullable: true })
  stageBreakdown: Record<AdoptionStage, number> | null;

  @Column({ name: 'aggregated_at', type: 'timestamptz' })
  aggregatedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
