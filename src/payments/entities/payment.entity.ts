import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Transaction } from './transaction.entity';
import { PaymentStatus, PaymentMethod } from '../interfaces/payment-provider.interface';

@Entity('payments')
@Index(['userId', 'status'])
@Index(['externalTransactionId'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount!: string;

  @Column({ length: 3, default: 'USD' })
  currency!: string;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status!: PaymentStatus;

  @Column({
    type: 'enum',
    enum: PaymentMethod,
  })
  paymentMethod!: PaymentMethod;

  @Column({ name: 'external_transaction_id', length: 255, nullable: true })
  externalTransactionId?: string;

  @Column({ name: 'payment_method_id', length: 255, nullable: true })
  paymentMethodId?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason?: string;

  @Column({ name: 'failure_code', length: 100, nullable: true })
  failureCode?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  refundedAmount!: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true })
  feeAmount?: string;

  @Column({ type: 'timestamp', nullable: true })
  completedAt?: Date;

  @Column({ name: 'provider', length: 50 })
  provider!: string; // 'stripe', 'paypal', etc.

  @Column({ name: 'receipt_url', nullable: true })
  receiptUrl?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => Transaction, (transaction) => transaction.payment, {
    cascade: true,
  })
  transactions!: Transaction[];
}
