import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { Achievement } from './achievement.entity';

@Entity('user_achievements')
@Unique(['userId', 'achievementId']) // Prevents duplicate awards
export class UserAchievement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Column('uuid')
  achievementId: string;

  @ManyToOne(() => Achievement, (a) => a.userAchievements, { eager: true })
  @JoinColumn({ name: 'achievementId' })
  achievement: Achievement;

  /** 0–100: percentage toward earning this badge (null once awarded) */
  @Column({ type: 'float', default: 0, nullable: true })
  progress: number | null;

  /** Snapshot of the metric value when the badge was awarded */
  @Column('jsonb', { nullable: true })
  awardedContext: Record<string, unknown> | null;

  @Column({ nullable: true })
  awardedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  get isAwarded(): boolean {
    return this.awardedAt !== null;
  }
}
