import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { LocalPaymentStatus } from '../providers/base-local.provider';

@Entity('local_payments')
@Index(['userId', 'provider'])
@Index(['status'])
@Index(['externalRef'])
export class LocalPayment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ length: 50 })
  provider!: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount!: string;

  @Column({ length: 3 })
  currency!: string;

  @Column({ length: 2 })
  country!: string;

  @Column({
    type: 'enum',
    enum: LocalPaymentStatus,
    default: LocalPaymentStatus.PENDING,
  })
  status!: LocalPaymentStatus;

  @Column({ name: 'external_ref', length: 255 })
  externalRef!: string;

  @Column({ name: 'checkout_url', length: 500, nullable: true })
  checkoutUrl?: string;

  @Column({ name: 'phone_number', length: 20, nullable: true })
  phoneNumber?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
