import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

@Entity('premium_subscriptions')
@Unique(['userId', 'providerId'])
@Index(['userId', 'status'])
export class PremiumSubscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id' })
  @Index()
  userId!: string;

  @Column({ name: 'provider_id' })
  @Index()
  providerId!: string;

  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.ACTIVE })
  status!: SubscriptionStatus;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ name: 'payment_reference', nullable: true })
  paymentReference?: string;

  @Column({ name: 'amount_paid', type: 'decimal', precision: 10, scale: 2, nullable: true })
  amountPaid?: string;

  @Column({ name: 'currency', length: 10, nullable: true })
  currency?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
