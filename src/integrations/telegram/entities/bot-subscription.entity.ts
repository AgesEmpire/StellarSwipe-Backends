import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type SubscriptionType = 'signals' | 'trades' | 'portfolio';

@Entity('bot_subscriptions')
@Index(['telegramId', 'type'], { unique: true })
export class BotSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint' })
  telegramId: number;

  @Column({ type: 'varchar' })
  type: SubscriptionType;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
