import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Funnel } from './funnel.entity';

@Entity('user_funnel_progress')
@Index(['userId', 'funnel'], { unique: true })
export class UserFunnelProgress {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId!: string;

  @ManyToOne(() => Funnel, (f) => f.progress, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'funnel_id' })
  funnel!: Funnel;

  @Column({ name: 'current_step', type: 'int', default: 0 })
  currentStep!: number;

  @Column({ name: 'completed_steps', type: 'jsonb', default: [] })
  completedSteps!: string[];

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @Column({ name: 'dropped_at_step', type: 'int', nullable: true })
  droppedAtStep?: number;

  @CreateDateColumn({ name: 'entered_at' })
  enteredAt!: Date;

  @Column({ name: 'last_activity_at', type: 'timestamptz', nullable: true })
  lastActivityAt?: Date;
}
