import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { UserSubscription } from './user-subscription.entity';

export enum TierLevel {
  FREE = 'FREE',
  BASIC = 'BASIC',
  PREMIUM = 'PREMIUM',
  CUSTOM = 'CUSTOM',
}

@Entity('subscription_tiers')
@Index(['providerId', 'active'])
@Index(['providerId', 'level'])
export class SubscriptionTier {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  @Index()
  providerId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider!: User;

  @Column({ length: 100 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({
    type: 'enum',
    enum: TierLevel,
    default: TierLevel.BASIC,
  })
  level!: TierLevel;

  /**
   * Monthly price in USDC (0 for FREE tier)
   */
  @Column({ type: 'decimal', precision: 18, scale: 7, default: '0' })
  price!: string;

  /**
   * Maximum signals visible per day; null = unlimited
   */
  @Column({ name: 'signal_limit', type: 'int', nullable: true })
  signalLimit?: number | null;

  /**
   * Array of benefit descriptions stored as jsonb
   */
  @Column({ type: 'jsonb', default: [] })
  benefits!: string[];

  @Column({ default: true })
  active!: boolean;

  /**
   * Soft-cancellation: tier can't accept new subscribers but existing ones stay
   */
  @Column({ name: 'accepting_new_subscribers', default: true })
  acceptingNewSubscribers!: boolean;

  /** Number of active subscribers currently on this tier */
  @Column({ name: 'subscriber_count', type: 'int', default: 0 })
  subscriberCount!: number;

  /** Total revenue ever collected for this tier (USDC) */
  @Column({
    name: 'total_revenue',
    type: 'decimal',
    precision: 18,
    scale: 7,
    default: '0',
  })
  totalRevenue!: string;

  @OneToMany(() => UserSubscription, (sub) => sub.tier)
  subscriptions!: UserSubscription[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt?: Date;
}
