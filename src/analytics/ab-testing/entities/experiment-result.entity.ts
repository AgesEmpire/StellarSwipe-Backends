import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('experiment_results')
@Index(['experimentId', 'createdAt'])
export class ExperimentResult {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'experiment_id' })
  @Index()
  experimentId!: string;

  @Column()
  name!: string;

  @Column({ type: 'jsonb' })
  variants!: Record<string, unknown>[];

  @Column({ name: 'confidence_level', type: 'float', default: 0.95 })
  confidenceLevel!: number;

  @Column({ name: 'is_significant', default: false })
  isSignificant!: boolean;

  @Column({ name: 'winning_variant', nullable: true })
  winningVariant!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  analysis!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
