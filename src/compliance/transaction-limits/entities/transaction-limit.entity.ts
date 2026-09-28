import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum LimitType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  PER_TRANSACTION = 'per_transaction',
}

export enum LimitScope {
  WITHDRAWAL = 'withdrawal',
  DEPOSIT = 'deposit',
  TRADE = 'trade',
  TRANSFER = 'transfer',
}

@Entity('transaction_limits')
@Index(['userTier', 'region', 'limitType', 'limitScope'])
export class TransactionLimit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  userTier: string; // 'basic', 'premium', 'enterprise', null for global

  @Column({ type: 'varchar', nullable: true })
  @Index()
  region: string; // ISO country code or null for global

  @Column({ type: 'enum', enum: LimitType })
  limitType: LimitType;

  @Column({ type: 'enum', enum: LimitScope })
  limitScope: LimitScope;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  limitAmount: string;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
