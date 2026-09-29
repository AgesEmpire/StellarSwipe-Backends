import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Ledger of trade fills already applied to holdings. The primary key makes
 * replayed trade events a no-op.
 */
@Entity('portfolio_applied_trades')
export class PortfolioAppliedTrade {
  @PrimaryColumn({ name: 'idempotency_key', length: 200 })
  idempotencyKey!: string;

  @Column({ name: 'trade_id', length: 128 })
  tradeId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @CreateDateColumn({ name: 'applied_at' })
  appliedAt!: Date;
}
