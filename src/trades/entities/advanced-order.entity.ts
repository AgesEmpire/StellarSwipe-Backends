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

// ─── Enums ─────────────────────────────────────────────────────────────────────

export enum AdvancedOrderType {
  OCO = 'OCO',
  ICEBERG = 'ICEBERG',
}

export enum AdvancedOrderStatus {
  ACTIVE = 'ACTIVE',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  PARTIALLY_FILLED = 'PARTIALLY_FILLED',
  EXPIRED = 'EXPIRED',
}

export enum OcoLeg {
  STOP_LOSS = 'STOP_LOSS',
  TAKE_PROFIT = 'TAKE_PROFIT',
}

// ─── Embedded-style interfaces stored as JSONB ──────────────────────────────

export interface LinkedOrderSnapshot {
  /** Stellar offer ID for this leg (set after submission) */
  offerId?: string;
  /** Stellar tx hash */
  txHash?: string;
  /** Price trigger for this leg */
  triggerPrice: number;
  /** Amount of this leg */
  amount: number;
  /** Whether this leg has been executed */
  executed: boolean;
  /** Execution timestamp */
  executedAt?: string;
}

export interface OcoOrderData {
  stopLoss: LinkedOrderSnapshot;
  takeProfit: LinkedOrderSnapshot;
  /** Leg that won the race (set when one fires) */
  triggeredLeg?: OcoLeg;
}

export interface IcebergOrderData {
  /** Full (hidden) order size */
  totalAmount: number;
  /** Amount visible in the order book at any time */
  displayAmount: number;
  /** Amount already filled in total */
  filledAmount: number;
  /** Amount currently visible / open in the order book */
  currentDisplayedAmount: number;
  /** Stellar offer ID for the currently-active displayed slice */
  activeOfferId?: string;
  /** How many times we have refilled the displayed slice */
  refillCount: number;
  /** Limit price for each displayed slice */
  limitPrice: number;
}

// ─── Entity ─────────────────────────────────────────────────────────────────

@Entity('advanced_orders')
export class AdvancedOrder {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** Optional link back to a position / parent trade */
  @Column({ name: 'position_id', type: 'uuid', nullable: true })
  @Index()
  positionId?: string;

  @Column({
    name: 'order_type',
    type: 'enum',
    enum: AdvancedOrderType,
  })
  @Index()
  orderType!: AdvancedOrderType;

  @Column({
    type: 'enum',
    enum: AdvancedOrderStatus,
    default: AdvancedOrderStatus.ACTIVE,
  })
  @Index()
  status!: AdvancedOrderStatus;

  // ── Asset pair ────────────────────────────────────────────────────────────

  @Column({ name: 'selling_asset_code', length: 20 })
  sellingAssetCode!: string;

  @Column({ name: 'selling_asset_issuer', length: 128, nullable: true })
  sellingAssetIssuer?: string;

  @Column({ name: 'buying_asset_code', length: 20 })
  buyingAssetCode!: string;

  @Column({ name: 'buying_asset_issuer', length: 128, nullable: true })
  buyingAssetIssuer?: string;

  // ── OCO-specific payload ──────────────────────────────────────────────────

  /** Populated only when orderType === OCO */
  @Column({ name: 'oco_data', type: 'jsonb', nullable: true })
  ocoData?: OcoOrderData;

  // ── Iceberg-specific payload ──────────────────────────────────────────────

  /** Populated only when orderType === ICEBERG */
  @Column({ name: 'iceberg_data', type: 'jsonb', nullable: true })
  icebergData?: IcebergOrderData;

  // ── Execution tracking ────────────────────────────────────────────────────

  @Column({ name: 'source_secret_encrypted', type: 'text', nullable: true })
  sourceSecretEncrypted?: string;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt?: Date;

  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt?: Date;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
