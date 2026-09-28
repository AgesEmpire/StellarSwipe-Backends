import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('pnl_history')
@Index(['userId', 'snapshotDate'])
export class PnlHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'asset_symbol', length: 100 })
  assetSymbol!: string;

  @Column({ name: 'signal_id', type: 'uuid', nullable: true })
  signalId?: string | null;

  @Column({ name: 'snapshot_date', type: 'timestamp with time zone' })
  snapshotDate!: Date;

  @Column({ name: 'realized_pnl', type: 'decimal', precision: 18, scale: 8, default: '0' })
  realizedPnL!: string;

  @Column({ name: 'unrealized_pnl', type: 'decimal', precision: 18, scale: 8, default: '0' })
  unrealizedPnL!: string;

  @Column({ name: 'total_pnl', type: 'decimal', precision: 18, scale: 8, default: '0' })
  totalPnL!: string;

  @Column({ name: 'total_fees', type: 'decimal', precision: 18, scale: 8, default: '0' })
  totalFees!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
