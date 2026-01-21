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
import { BetaUser } from './beta-user.entity';

export enum FeedbackType {
  BUG = 'bug',
  FEATURE_REQUEST = 'feature_request',
  IMPROVEMENT = 'improvement',
  GENERAL = 'general',
}

export enum FeedbackStatus {
  NEW = 'new',
  REVIEWED = 'reviewed',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

@Entity('beta_feedback')
export class Feedback {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'beta_user_id', type: 'uuid' })
  @Index()
  betaUserId!: string;

  @ManyToOne(() => BetaUser)
  @JoinColumn({ name: 'beta_user_id' })
  betaUser!: BetaUser;

  @Column({
    type: 'enum',
    enum: FeedbackType,
    default: FeedbackType.GENERAL,
  })
  @Index()
  type!: FeedbackType;

  @Column({
    type: 'enum',
    enum: FeedbackStatus,
    default: FeedbackStatus.NEW,
  })
  @Index()
  status!: FeedbackStatus;

  @Column({ length: 255 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'int', nullable: true })
  rating?: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
