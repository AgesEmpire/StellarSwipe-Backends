import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum TradeStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed', // Included in ledger
  SETTLED = 'settled', // Trade completed on SDEX
  EXECUTING = 'executing',
  COMPLETED = 'completed', // Legacy, alias to SETTLED
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum TradeSide {
  BUY = 'buy',
  SELL = 'sell',
}

@Entity('trades')
@Index(['user_id', 'status'], { name: 'idx_trades_user_status' })
@Index(['user_id', 'created_at'], { name: 'idx_trades_user_created' })
export class Trade {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId!: string;

  @ManyToOne(() => User, (user) => user.trades)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'signal_id', type: 'uuid' })
  @Index()
  signalId!: string;

  @Column({
    type: 'enum',
    enum: TradeStatus,
    default: TradeStatus.PENDING,
  })
  @Index()
  status!: TradeStatus;

  @Column({
    type: 'enum',
    enum: TradeSide,
  })
  side!: TradeSide;

  @Column({ name: 'base_asset', length: 100 })
  baseAsset!: string;

  @Column({ name: 'counter_asset', length: 100 })
  counterAsset!: string;

  @Column({ name: 'entry_price', type: 'decimal', precision: 18, scale: 8 })
  entryPrice!: string;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  amount!: string;

  @Column({ name: 'total_value', type: 'decimal', precision: 18, scale: 8 })
  totalValue!: string;

  @Column({
    name: 'fee_amount',
    type: 'decimal',
    precision: 18,
    scale: 8,
    default: '0',
  })
  feeAmount!: string;

  @Column({
    name: 'transaction_hash',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  @Index()
  transactionHash?: string;

  @Column({
    name: 'soroban_contract_id',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  sorobanContractId?: string;

  @Column({ name: 'ledger', type: 'integer', nullable: true })
  ledger?: number;

  @Column({
    name: 'exit_price',
    type: 'decimal',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  exitPrice?: string;

  @Column({
    name: 'profit_loss',
    type: 'decimal',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  profitLoss?: string;

  @Column({
    name: 'profit_loss_percentage',
    type: 'decimal',
    precision: 8,
    scale: 4,
    nullable: true,
  })
  profitLossPercentage?: string;

  @Column({
    name: 'stop_loss_price',
    type: 'decimal',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  stopLossPrice?: string;

  @Column({
    name: 'take_profit_price',
    type: 'decimal',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  takeProfitPrice?: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'executed_at', type: 'timestamp', nullable: true })
  executedAt?: Date;

  @Column({ name: 'closed_at', type: 'timestamp', nullable: true })
  closedAt?: Date;

  @Column({ name: 'parent_trade_id', type: 'uuid', nullable: true })
  @Index()
  parentTradeId?: string;

  @Column({
    name: 'original_amount',
    type: 'decimal',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  originalAmount?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
