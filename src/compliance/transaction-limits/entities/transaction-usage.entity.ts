import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  VersionColumn,
  Index,
} from 'typeorm';
import { LimitType, LimitScope } from './transaction-limit.entity';

@Entity('transaction_usage')
@Index(['userId', 'limitType', 'limitScope', 'periodStart'])
export class TransactionUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @Column({ type: 'enum', enum: LimitType })
  limitType: LimitType;

  @Column({ type: 'enum', enum: LimitScope })
  limitScope: LimitScope;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  usedAmount: string;

  @Column({ type: 'varchar', length: 10 })
  currency: string;

  @Column({ type: 'timestamp' })
  @Index()
  periodStart: Date;

  @Column({ type: 'timestamp' })
  periodEnd: Date;

  @CreateDateColumn()
  createdAt: Date;

  /** Optimistic concurrency guard — prevents lost updates when concurrent transactions race to increment usage. */
  @VersionColumn()
  version: number;
}
