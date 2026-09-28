import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type SubscriptionTopic = 'signals' | 'leaderboard' | 'announcements' | 'market';

@Entity('channel_subscriptions')
@Index(['guildId', 'topic'], { unique: true })
export class ChannelSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  guildId: string;

  @Column()
  channelId: string;

  @Column({ type: 'varchar' })
  topic: SubscriptionTopic;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
