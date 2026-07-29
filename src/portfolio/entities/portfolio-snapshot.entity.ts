import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('portfolio_snapshots')
@Index(['userId', 'computedAt'])
export class PortfolioSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'realized_pnl', type: 'decimal', precision: 18, scale: 8, default: '0' })
  realizedPnl!: string;

  @Column({ name: 'unrealized_pnl', type: 'decimal', precision: 18, scale: 8, default: '0' })
  unrealizedPnl!: string;

  @Column({ name: 'total_pnl', type: 'decimal', precision: 18, scale: 8, default: '0' })
  totalPnl!: string;

  @Column({ name: 'portfolio_value', type: 'decimal', precision: 18, scale: 8, default: '0' })
  portfolioValue!: string;

  @Column({ name: 'computed_at', type: 'timestamp' })
  computedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
