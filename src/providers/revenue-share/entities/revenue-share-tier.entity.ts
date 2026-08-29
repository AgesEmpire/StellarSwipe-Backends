import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  Index,
} from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export enum ProviderTierLevel {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
  ELITE = 'ELITE',
}

export enum PayoutStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export enum BonusType {
  PERFORMANCE = 'PERFORMANCE',
  MONTHLY_TOP = 'MONTHLY_TOP',
  STREAK = 'STREAK',
  MILESTONE = 'MILESTONE',
  REFERRAL = 'REFERRAL',
}

// ─────────────────────────────────────────────────────────────────────────────
// RevenueSharTier – configurable tier definitions stored in DB
// ─────────────────────────────────────────────────────────────────────────────

@Entity('revenue_share_tiers')
export class RevenueShareTier {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: ProviderTierLevel, unique: true })
  tierLevel!: ProviderTierLevel;

  /** Human-readable label, e.g. "Elite Provider" */
  @Column({ length: 100 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  /**
   * Revenue-share percentage awarded to the provider from subscription /
   * copy-trade revenue attributed to them.
   * Stored as a percentage value, e.g. 10.00 = 10 %.
   */
  @Column({ name: 'revenue_share_percentage', type: 'decimal', precision: 5, scale: 2, default: '0' })
  revenueSharePercentage!: string;

  /**
   * Minimum win-rate (%) required to qualify for this tier.
   */
  @Column({ name: 'min_win_rate', type: 'decimal', precision: 5, scale: 2, default: '0' })
  minWinRate!: string;

  /**
   * Minimum number of closed signals required.
   */
  @Column({ name: 'min_signals', type: 'int', default: 0 })
  minSignals!: number;

  /**
   * Minimum number of active copiers required.
   */
  @Column({ name: 'min_copiers', type: 'int', default: 0 })
  minCopiers!: number;

  /**
   * Minimum reputation score required.
   */
  @Column({ name: 'min_reputation_score', type: 'decimal', precision: 5, scale: 2, default: '0' })
  minReputationScore!: string;

  /**
   * Flat performance bonus (USDC) credited when provider achieves this tier.
   */
  @Column({ name: 'performance_bonus_usdc', type: 'decimal', precision: 18, scale: 8, default: '0' })
  performanceBonusUsdc!: string;

  /**
   * Monthly retention bonus (USDC) paid as long as provider stays in this tier.
   */
  @Column({ name: 'monthly_retention_bonus_usdc', type: 'decimal', precision: 18, scale: 8, default: '0' })
  monthlyRetentionBonusUsdc!: string;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  /** Display order on the leaderboard / UI */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  /** Optimistic concurrency token — bumped on every update. */
  @VersionColumn()
  version!: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ProviderRevenuePayout – immutable log of every amount paid to a provider
// ─────────────────────────────────────────────────────────────────────────────

@Entity('provider_revenue_payouts')
export class ProviderRevenuePayout {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId!: string;

  @Column({ type: 'enum', enum: ProviderTierLevel })
  tierLevel!: ProviderTierLevel;

  /** Revenue base that the share was calculated on (USDC). */
  @Column({ name: 'base_revenue', type: 'decimal', precision: 18, scale: 8 })
  baseRevenue!: string;

  /** Applied share percentage at time of calculation. */
  @Column({ name: 'share_percentage', type: 'decimal', precision: 5, scale: 2 })
  sharePercentage!: string;

  /** Revenue share amount = baseRevenue × sharePercentage / 100 */
  @Column({ name: 'revenue_share_amount', type: 'decimal', precision: 18, scale: 8 })
  revenueShareAmount!: string;

  /** Performance or retention bonus included in this payout (may be 0). */
  @Column({ name: 'bonus_amount', type: 'decimal', precision: 18, scale: 8, default: '0' })
  bonusAmount!: string;

  @Column({ name: 'bonus_type', type: 'enum', enum: BonusType, nullable: true })
  bonusType?: BonusType;

  /** Total = revenueShareAmount + bonusAmount */
  @Column({ name: 'total_payout', type: 'decimal', precision: 18, scale: 8 })
  totalPayout!: string;

  @Column({ name: 'asset_code', length: 12, default: 'USDC' })
  assetCode!: string;

  @Column({ name: 'provider_wallet_address', length: 56 })
  providerWalletAddress!: string;

  @Column({ type: 'enum', enum: PayoutStatus, default: PayoutStatus.PENDING })
  status!: PayoutStatus;

  @Column({ name: 'stellar_tx_hash', length: 64, nullable: true })
  stellarTxHash?: string;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason?: string;

  /** Billing period this payout covers. */
  @Column({ name: 'period_year', type: 'int' })
  periodYear!: number;

  @Column({ name: 'period_month', type: 'int' })
  periodMonth!: number;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount!: number;

  @Column({ name: 'paid_at', type: 'timestamp with time zone', nullable: true })
  paidAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// ProviderTierAssignment – tracks which tier a provider is currently in
// ─────────────────────────────────────────────────────────────────────────────

@Entity('provider_tier_assignments')
export class ProviderTierAssignment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId!: string;

  @Column({
    name: 'current_tier',
    type: 'enum',
    enum: ProviderTierLevel,
    default: ProviderTierLevel.BRONZE,
  })
  currentTier!: ProviderTierLevel;

  @Column({
    name: 'previous_tier',
    type: 'enum',
    enum: ProviderTierLevel,
    nullable: true,
  })
  previousTier?: ProviderTierLevel;

  /** Snapshot of metrics captured at last evaluation. */
  @Column({ name: 'win_rate_snapshot', type: 'decimal', precision: 5, scale: 2, default: '0' })
  winRateSnapshot!: string;

  @Column({ name: 'signals_snapshot', type: 'int', default: 0 })
  signalsSnapshot!: number;

  @Column({ name: 'copiers_snapshot', type: 'int', default: 0 })
  copiersSnapshot!: number;

  @Column({ name: 'reputation_snapshot', type: 'decimal', precision: 5, scale: 2, default: '0' })
  reputationSnapshot!: string;

  @Column({ name: 'last_evaluated_at', type: 'timestamp with time zone', nullable: true })
  lastEvaluatedAt?: Date;

  /** Whether provider has received their tier-promotion bonus already. */
  @Column({ name: 'promotion_bonus_paid', default: false })
  promotionBonusPaid!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
