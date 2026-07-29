import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('cohorts')
@Index(['cohortType', 'cohortKey'], { unique: true })
export class Cohort {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'cohort_type' })
  cohortType!: string;

  @Column({ name: 'cohort_key' })
  cohortKey!: string;

  @Column({ name: 'cohort_size', type: 'int', default: 0 })
  cohortSize!: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
