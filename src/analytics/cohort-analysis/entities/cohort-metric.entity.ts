import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('cohort_metrics')
@Index(['cohortType', 'cohortKey', 'periodIndex'], { unique: true })
export class CohortMetric {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'cohort_type' })
  cohortType!: string;

  @Column({ name: 'cohort_key' })
  cohortKey!: string;

  @Column({ name: 'period_index', type: 'int' })
  periodIndex!: number;

  @Column({ name: 'active_users', type: 'int', default: 0 })
  activeUsers!: number;

  @Column({ name: 'retention_rate', type: 'float', default: 0 })
  retentionRate!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
