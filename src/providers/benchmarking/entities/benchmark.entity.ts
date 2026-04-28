import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import {
  BenchmarkType,
  PerformanceTier,
} from '../interfaces/benchmark-metric.interface';

@Entity('provider_benchmarks')
@Index(['providerId', 'periodStart', 'benchmarkType'])
@Index(['benchmarkType', 'overallPercentile'])
export class ProviderBenchmark {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'provider_id' })
  @Index()
  providerId: string;

  @Column({
    name: 'benchmark_type',
    type: 'enum',
    enum: BenchmarkType,
  })
  benchmarkType: BenchmarkType;

  @Column({ name: 'reference_id', nullable: true })
  referenceId: string | null;

  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart: Date;

  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd: Date;

  @Column({ name: 'overall_score', type: 'decimal', precision: 8, scale: 4 })
  overallScore: number;

  @Column({
    name: 'overall_percentile',
    type: 'decimal',
    precision: 5,
    scale: 2,
  })
  overallPercentile: number;

  @Column({
    name: 'overall_tier',
    type: 'enum',
    enum: PerformanceTier,
  })
  overallTier: PerformanceTier;

  @Column({ name: 'metrics', type: 'jsonb' })
  metrics: Record<string, any>[];

  @Column({ name: 'platform_stats', type: 'jsonb', nullable: true })
  platformStats: Record<string, any> | null;

  @Column({ name: 'sample_size', type: 'int', default: 0 })
  sampleSize: number;

  @Column({ name: 'calculated_at', type: 'timestamptz' })
  calculatedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
