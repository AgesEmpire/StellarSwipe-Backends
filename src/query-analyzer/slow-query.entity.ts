import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { QueryOptimization } from './query-optimization.entity';

export enum QueryStatus {
  PENDING = 'pending',
  ANALYZING = 'analyzing',
  OPTIMIZED = 'optimized',
  FAILED = 'failed',
}

export enum QueryComplexity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

@Entity('slow_queries')
@Index(['executionTime', 'capturedAt'])
@Index(['queryHash'], { unique: false })
export class SlowQuery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'query_text', type: 'text' })
  queryText: string;

  @Column({ name: 'query_hash', length: 64 })
  @Index()
  queryHash: string;

  @Column({ name: 'normalized_query', type: 'text', nullable: true })
  normalizedQuery: string | null;

  @Column({
    name: 'execution_time',
    type: 'float',
    comment: 'Execution time in milliseconds',
  })
  executionTime: number;

  @Column({ name: 'rows_examined', type: 'bigint', nullable: true })
  rowsExamined: number | null;

  @Column({ name: 'rows_returned', type: 'bigint', nullable: true })
  rowsReturned: number | null;

  @Column({ name: 'database_name', length: 128, nullable: true })
  databaseName: string | null;

  @Column({ name: 'schema_name', length: 128, nullable: true })
  schemaName: string | null;

  @Column({ name: 'caller_service', length: 128, nullable: true })
  callerService: string | null;

  @Column({ name: 'caller_endpoint', length: 512, nullable: true })
  callerEndpoint: string | null;

  @Column({ type: 'jsonb', name: 'explain_output', nullable: true })
  explainOutput: Record<string, any> | null;

  @Column({ type: 'jsonb', name: 'explain_analyze_output', nullable: true })
  explainAnalyzeOutput: Record<string, any> | null;

  @Column({ type: 'jsonb', name: 'parameters', nullable: true })
  parameters: any[] | null;

  @Column({
    type: 'enum',
    enum: QueryStatus,
    default: QueryStatus.PENDING,
  })
  status: QueryStatus;

  @Column({
    type: 'enum',
    enum: QueryComplexity,
    nullable: true,
  })
  complexity: QueryComplexity | null;

  @Column({ name: 'execution_count', type: 'int', default: 1 })
  executionCount: number;

  @Column({
    name: 'avg_execution_time',
    type: 'float',
    nullable: true,
    comment: 'Rolling average execution time in ms',
  })
  avgExecutionTime: number | null;

  @Column({ name: 'total_cost', type: 'float', nullable: true })
  totalCost: number | null;

  @Column({ name: 'seq_scans', type: 'int', nullable: true })
  seqScans: number | null;

  @Column({ name: 'index_scans', type: 'int', nullable: true })
  indexScans: number | null;

  @Column({ name: 'tables_involved', type: 'text', array: true, default: [] })
  tablesInvolved: string[];

  @Column({
    name: 'has_missing_indexes',
    type: 'boolean',
    default: false,
  })
  hasMissingIndexes: boolean;

  @Column({
    name: 'has_suboptimal_joins',
    type: 'boolean',
    default: false,
  })
  hasSuboptimalJoins: boolean;

  @Column({ name: 'analysis_error', type: 'text', nullable: true })
  analysisError: string | null;

  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => QueryOptimization, (opt) => opt.slowQuery, { cascade: true })
  optimizations: QueryOptimization[];
}
