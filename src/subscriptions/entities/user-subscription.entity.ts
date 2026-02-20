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
import { User } from '../../users/entities/user.entity';
import { SubscriptionTier } from './subscription-tier.entity';

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
  SUSPENDED = 'SUSPENDED', // payment failed
  PENDING_PAYMENT = 'PENDING_PAYMENT',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

@Entity('user_subscriptions')
@Index(['userId', 'status'])
@Index(['tierId', 'status'])
@Index(['renewsAt'])
export class UserSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The subscriber */
  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** The tier being subscribed to */
  @Column({ name: 'tier_id', type: 'uuid' })
  @Index()
  tierId!: string;

  @ManyToOne(() => SubscriptionTier, (tier) => tier.subscriptions, {
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'tier_id' })
  tier!: SubscriptionTier;

  /** Cached provider id for quick access-control checks */
  @Column({ name: 'provider_id', type: 'uuid' })
  @Index()
  providerId!: string;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.PENDING_PAYMENT,
  })
  @Index()
  status!: SubscriptionStatus;

  /** The amount paid in USDC for this billing cycle */
  @Column({ name: 'amount_paid', type: 'decimal', precision: 18, scale: 7 })
  amountPaid!: string;

  /** Platform commission (20%) taken from the payment */
  @Column({
    name: 'platform_commission',
    type: 'decimal',
    precision: 18,
    scale: 7,
    default: '0',
  })
  platformCommission!: string;

  /** Net amount sent to the provider */
  @Column({
    name: 'provider_earnings',
    type: 'decimal',
    precision: 18,
    scale: 7,
    default: '0',
  })
  providerEarnings!: string;

  /** Stellar transaction hash of the subscription payment */
  @Column({ name: 'stellar_tx_hash', nullable: true, length: 64 })
  stellarTxHash?: string;

  /** Current payment status for the latest billing cycle */
  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  paymentStatus!: PaymentStatus;

  /** When the current billing period started */
  @Column({ name: 'period_start', type: 'timestamp with time zone' })
  periodStart!: Date;

  /** When the current billing period ends */
  @Column({ name: 'period_end', type: 'timestamp with time zone' })
  periodEnd!: Date;

  /** Next scheduled auto-renewal date */
  @Column({ name: 'renews_at', type: 'timestamp with time zone', nullable: true })
  renewsAt?: Date;

  /** How many times auto-renewal has succeeded */
  @Column({ name: 'renewal_count', type: 'int', default: 0 })
  renewalCount!: number;

  /** How many consecutive payment failures occurred */
  @Column({ name: 'payment_failure_count', type: 'int', default: 0 })
  paymentFailureCount!: number;

  /** Last payment failure reason */
  @Column({ name: 'last_failure_reason', type: 'text', nullable: true })
  lastFailureReason?: string;

  /** User's Stellar wallet address at the time of subscription */
  @Column({ name: 'subscriber_wallet', length: 56 })
  subscriberWallet!: string;

  /** Provider's Stellar wallet address at the time of subscription */
  @Column({ name: 'provider_wallet', length: 56 })
  providerWallet!: string;

  /** Whether the user has opted out of auto-renewal */
  @Column({ name: 'auto_renew', default: true })
  autoRenew!: boolean;

  /** When the subscription was cancelled (if applicable) */
  @Column({ name: 'cancelled_at', type: 'timestamp with time zone', nullable: true })
  cancelledAt?: Date;

  /** Reason for cancellation */
  @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
  cancellationReason?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
