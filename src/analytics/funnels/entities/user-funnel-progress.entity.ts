import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('user_funnel_progress')
@Index(['userId', 'funnelName'], { unique: true })
export class UserFunnelProgress {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId!: string;

  @Column({ name: 'funnel_name', type: 'varchar', length: 100 })
  funnelName!: string;

  @Column({ name: 'current_step', type: 'varchar', length: 100 })
  currentStep!: string;

  @Column({ name: 'completed_steps', type: 'jsonb', default: [] })
  completedSteps!: { key: string; completedAt: string }[];

  @Column({ name: 'is_converted', type: 'boolean', default: false })
  isConverted!: boolean;

  @Column({ name: 'converted_at', type: 'timestamptz', nullable: true })
  convertedAt?: Date;

  @Column({ name: 'dropped_at_step', type: 'varchar', length: 100, nullable: true })
  droppedAtStep?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
