import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('payment_methods')
@Index(['userId', 'provider'])
@Index(['fingerprint'])
export class PaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ length: 50 })
  type!: string; // 'card', 'bank_account', 'paypal', etc.

  @Column({ length: 50 })
  provider!: string; // 'stripe', 'paypal', etc.

  @Column({ name: 'provider_token', length: 255 })
  providerToken!: string;

  @Column({ name: 'display_name', nullable: true })
  displayName?: string;

  @Column({ name: 'last_four', length: 4, nullable: true })
  lastFour?: string;

  @Column({ name: 'card_brand', length: 50, nullable: true })
  cardBrand?: string;

  @Column({ name: 'expiry_month', nullable: true })
  expiryMonth?: number;

  @Column({ name: 'expiry_year', nullable: true })
  expiryYear?: number;

  @Column({ name: 'is_default', default: false })
  isDefault!: boolean;

  @Column({ name: 'fingerprint', length: 255, nullable: true })
  fingerprint?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt?: Date;
}
