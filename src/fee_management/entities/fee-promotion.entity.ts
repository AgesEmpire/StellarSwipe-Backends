import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum PromotionStatus {
  ACTIVE = 'ACTIVE',
  SCHEDULED = 'SCHEDULED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum PromotionType {
  PERCENTAGE_DISCOUNT = 'PERCENTAGE_DISCOUNT',
  FIXED_FEE = 'FIXED_FEE',
  FEE_WAIVER = 'FEE_WAIVER',
}

@Entity('fee_promotions')
@Index('idx_fp_code', ['promoCode'], { unique: true })
@Index('idx_fp_status', ['status'])
@Index('idx_fp_dates', ['startDate', 'endDate'])
export class FeePromotion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'promo_code', length: 50 })
  promoCode!: string;

  @Column({ length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'enum', enum: PromotionType })
  promotionType!: PromotionType;

  /**
   * Discount percentage (e.g., 50 for 50% off)
   */
  @Column({
    name: 'discount_percentage',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  discountPercentage?: string;

  /**
   * Fixed fee rate during promotion (e.g., '0' for free)
   */
  @Column({
    name: 'fixed_fee_rate',
    type: 'decimal',
    precision: 8,
    scale: 6,
    nullable: true,
  })
  fixedFeeRate?: string;

  /**
   * Maximum discount amount in USD (for percentage discounts)
   */
  @Column({
    name: 'max_discount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  maxDiscount?: string;

  /**
   * When the promotion starts
   */
  @Column({ name: 'start_date', type: 'timestamp with time zone' })
  startDate!: Date;

  /**
   * When the promotion ends
   */
  @Column({ name: 'end_date', type: 'timestamp with time zone' })
  endDate!: Date;

  /**
   * Maximum number of uses (null = unlimited)
   */
  @Column({ name: 'max_uses', type: 'int', nullable: true })
  maxUses?: number;

  /**
   * Current number of uses
   */
  @Column({ name: 'current_uses', type: 'int', default: 0 })
  currentUses!: number;

  /**
   * Maximum uses per user (null = unlimited)
   */
  @Column({ name: 'max_uses_per_user', type: 'int', nullable: true })
  maxUsesPerUser?: number;

  /**
   * Required minimum trade amount to use this promotion
   */
  @Column({
    name: 'min_trade_amount',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  minTradeAmount?: string;

  /**
   * Comma-separated list of asset codes this promotion applies to (null = all)
   */
  @Column({ name: 'applicable_assets', type: 'text', nullable: true })
  applicableAssets?: string;

  /**
   * Specific user IDs that can use this promotion (null = all users)
   */
  @Column({
    name: 'eligible_user_ids',
    type: 'text',
    array: true,
    nullable: true,
  })
  eligibleUserIds?: string[];

  /**
   * Whether the promotion requires a promo code (false = automatic)
   */
  @Column({ name: 'requires_code', default: true })
  requiresCode!: boolean;

  @Column({
    type: 'enum',
    enum: PromotionStatus,
    default: PromotionStatus.SCHEDULED,
  })
  status!: PromotionStatus;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}

// Table to track individual promotion redemptions
@Entity('fee_promotion_redemptions')
@Index('idx_fpr_promotion_id', ['promotionId'])
@Index('idx_fpr_user_id', ['userId'])
export class FeePromotionRedemption {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'promotion_id', type: 'uuid' })
  promotionId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'trade_id', type: 'uuid', nullable: true })
  tradeId?: string;

  @Column({ name: 'original_fee', type: 'decimal', precision: 18, scale: 8 })
  originalFee!: string;

  @Column({ name: 'discounted_fee', type: 'decimal', precision: 18, scale: 8 })
  discountedFee!: string;

  @Column({ name: 'savings', type: 'decimal', precision: 18, scale: 8 })
  savings!: string;

  @CreateDateColumn({ name: 'redeemed_at', type: 'timestamp with time zone' })
  redeemedAt!: Date;
}
