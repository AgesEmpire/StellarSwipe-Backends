import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum FeeStatus {
  PENDING = 'PENDING',
  COLLECTED = 'COLLECTED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum FeeTier {
  STANDARD = 'STANDARD',
  HIGH_VOLUME = 'HIGH_VOLUME',
  VIP = 'VIP',
  PROMOTIONAL = 'PROMOTIONAL',
}

@Entity('fee_transactions')
@Index(['userId', 'createdAt'])
@Index(['status', 'createdAt'])
@Index(['feeTier'])
export class FeeTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  userId!: string;

  @Column({ type: 'decimal', precision: 20, scale: 7 })
  tradeAmount!: string;

  @Column({ type: 'decimal', precision: 20, scale: 7 })
  feeAmount!: string;

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  feeRate!: string; // Stored as decimal (e.g., 0.001 for 0.1%)

  @Column({
    type: 'enum',
    enum: FeeTier,
    default: FeeTier.STANDARD,
  })
  feeTier!: FeeTier;

  @Column({
    type: 'enum',
    enum: FeeStatus,
    default: FeeStatus.PENDING,
  })
  @Index()
  status!: FeeStatus;

  @Column({ nullable: true })
  tradeId?: string;

  @Column({ nullable: true })
  stellarTransactionHash?: string;

  @Column()
  assetCode!: string;

  @Column()
  assetIssuer!: string;

  @Column({ nullable: true })
  platformWalletAddress!: string;

  @Column({ type: 'text', nullable: true })
  failureReason?: string;

  @Column({ type: 'int', default: 0 })
  retryCount!: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    promotionCode?: string;
    originalFeeRate?: string;
    userTier?: string;
    monthlyVolume?: string;
    [key: string]: any;
  };

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  collectedAt?: Date;
}