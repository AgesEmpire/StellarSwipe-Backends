import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum ActivityType {
  TRADE_EXECUTED = 'TRADE_EXECUTED',
  SIGNAL_FOLLOWED = 'SIGNAL_FOLLOWED',
  SWIPE_RIGHT = 'SWIPE_RIGHT',
  SWIPE_LEFT = 'SWIPE_LEFT',
  FOLLOW_SIGNAL = 'FOLLOW_SIGNAL',
  UPDATE_SETTINGS = 'UPDATE_SETTINGS',
}

@Entity('activities')
@Index(['userId', 'createdAt'])
@Index(['userId', 'type', 'createdAt'])
export class Activity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @Column({ type: 'enum', enum: ActivityType })
  type: ActivityType;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
