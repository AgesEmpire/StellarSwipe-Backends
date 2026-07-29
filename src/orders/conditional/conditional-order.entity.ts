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
import { ConditionalOrderStatus, ConditionalOrderSide } from './dto/create-conditional-order.dto';

@Entity('conditional_orders')
@Index('idx_cond_order_user', ['userId'])
@Index('idx_cond_order_status', ['status'])
export class ConditionalOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({
    name: 'side',
    type: 'enum',
    enum: ConditionalOrderSide,
  })
  side!: ConditionalOrderSide;

  @Column({ name: 'selling_asset_code', length: 20 })
  sellingAssetCode!: string;

  @Column({ name: 'selling_asset_issuer', length: 128, nullable: true })
  sellingAssetIssuer?: string;

  @Column({ name: 'buying_asset_code', length: 20 })
  buyingAssetCode!: string;

  @Column({ name: 'buying_asset_issuer', length: 128, nullable: true })
  buyingAssetIssuer?: string;

  @Column({ type: 'decimal', precision: 20, scale: 8 })
  amount!: number;

  @Column({ name: 'limit_price', type: 'decimal', precision: 20, scale: 8, nullable: true })
  limitPrice?: number;

  @Column({ name: 'slippage_tolerance', type: 'decimal', precision: 4, scale: 2, default: 1 })
  slippageTolerance!: number;

  /** JSONB payload storing the condition groups */
  @Column({ name: 'conditions', type: 'jsonb' })
  conditions!: Record<string, any>;

  @Column({
    type: 'enum',
    enum: ConditionalOrderStatus,
    default: ConditionalOrderStatus.PENDING,
  })
  status!: ConditionalOrderStatus;

  @Column({ name: 'triggered_at', type: 'timestamptz', nullable: true })
  triggeredAt?: Date;

  @Column({ name: 'filled_at', type: 'timestamptz', nullable: true })
  filledAt?: Date;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt?: Date;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'resulting_trade_id', type: 'uuid', nullable: true })
  resultingTradeId?: string;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
