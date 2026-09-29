import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('portfolio_holdings')
@Index('UQ_portfolio_holdings_user_asset', ['userId', 'asset'], { unique: true })
export class PortfolioHolding {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ length: 100 })
  asset!: string;

  @Column({ type: 'decimal', precision: 28, scale: 8, default: '0' })
  quantity!: string;

  /** Total cost of the open quantity (average-cost method). */
  @Column({ name: 'cost_basis', type: 'decimal', precision: 28, scale: 8, default: '0' })
  costBasis!: string;

  @Column({ name: 'last_trade_at', type: 'timestamptz', nullable: true })
  lastTradeAt?: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
