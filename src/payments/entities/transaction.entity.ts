import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Payment } from './payment.entity';

export enum TransactionType {
  CHARGE = 'charge',
  REFUND = 'refund',
  DISPUTE = 'dispute',
  CHARGEBACK = 'chargeback',
}

@Entity('transactions')
@Index(['paymentId'])
@Index(['externalId'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId!: string;

  @ManyToOne(() => Payment, (payment) => payment.transactions)
  @JoinColumn({ name: 'payment_id' })
  payment!: Payment;

  @Column({
    type: 'enum',
    enum: TransactionType,
  })
  type!: TransactionType;

  @Column({ name: 'external_id', length: 255, nullable: true })
  externalId?: string;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  amount!: string;

  @Column({ length: 50 })
  status!: string; // 'success', 'failed', 'pending'

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ type: 'jsonb', nullable: true })
  response?: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;
}
