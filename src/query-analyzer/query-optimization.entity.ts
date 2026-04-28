import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { SlowQuery } from './slow-query.entity';

export enum OptimizationType {
  INDEX = 'index',
  QUERY_REWRITE = 'query_rewrite',
  JOIN_OPTIMIZATION = 'join_optimization',
  SCHEMA_CHANGE = 'schema_change',
  CONFIGURATION = 'configuration',
  PARTITIONING = 'partitioning',
  CACHING = 'caching',
}

export enum OptimizationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum OptimizationStatus {
  SUGGESTED = 'suggested',
  ACCEPTED = 'accepted',
  APPLIED = 'applied',
  REJECTED = 'rejected',
  SUPERSEDED = 'superseded',
}

@Entity('query_optimizations')
@Index(['slowQueryId', 'type'])
export class QueryOptimization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'slow_query_id' })
  @Index()
  slowQueryId: string;

  @ManyToOne(() => SlowQuery, (sq) => sq.optimizations, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'slow_query_id' })
  slowQuery: SlowQuery;

  @Column({
    type: 'enum',
    enum: OptimizationType,
  })
  type: OptimizationType;

  @Column({
    type: 'enum',
    enum: OptimizationPriority,
    default: OptimizationPriority.MEDIUM,
  })
  priority: OptimizationPriority;

  @Column({
    type: 'enum',
    enum: OptimizationStatus,
    default: OptimizationStatus.SUGGESTED,
  })
  status: OptimizationStatus;

  @Column({ length: 512 })
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ name: 'sql_statement', type: 'text', nullable: true })
  sqlStatement: string | null;

  @Column({ name: 'rewritten_query', type: 'text', nullable: true })
  rewrittenQuery: string | null;

  @Column({ name: 'estimated_improvement', type: 'float', nullable: true })
  estimatedImprovement: number | null;

  @Column({ name: 'estimated_time_saved_ms', type: 'float', nullable: true })
  estimatedTimeSavedMs: number | null;

  @Column({ name: 'affected_table', length: 256, nullable: true })
  affectedTable: string | null;

  @Column({ name: 'affected_columns', type: 'text', array: true, default: [] })
  affectedColumns: string[];

  @Column({ type: 'jsonb', name: 'metadata', nullable: true })
  metadata: Record<string, any> | null;

  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true })
  appliedAt: Date | null;

  @Column({ name: 'applied_by', length: 128, nullable: true })
  appliedBy: string | null;

  @Column({ name: 'verified_improvement', type: 'float', nullable: true })
  verifiedImprovement: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
