import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UserAchievement } from './user-achievement.entity';

export type AchievementRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type AchievementCriteria =
  | { type: 'trade_count'; count: number }
  | { type: 'win_streak'; streak: number }
  | { type: 'signal_count'; count: number }
  | { type: 'signal_copies'; copies: number }
  | { type: 'position_hold_days'; days: number }
  | { type: 'profitable_month' }
  | { type: 'custom'; key: string; threshold: number };

@Entity('achievements')
export class Achievement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  key: string; // e.g. "first_trade", "hot_streak"

  @Column()
  name: string;

  @Column('text')
  description: string;

  @Column('jsonb')
  criteria: AchievementCriteria;

  @Column({ nullable: true })
  badgeImage: string;

  @Column({ type: 'varchar', default: 'common' })
  rarity: AchievementRarity;

  @Column({ default: true })
  isActive: boolean;

  @OneToMany(() => UserAchievement, (ua) => ua.achievement)
  userAchievements: UserAchievement[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
