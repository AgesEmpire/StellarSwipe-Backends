import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum FeeTierType {
  STANDARD = 'STANDARD',
  HIGH_VOLUME = 'HIGH_VOLUME',
  VIP = 'VIP',
  PROMOTIONAL = 'PROMOTIONAL',
}

@Entity('fee_tiers')
@Index('idx_ft_tier_type', ['tierType'])
@Index('idx_ft_is_active', ['isActive'])
export class FeeTier {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: FeeTierType, unique: true })
  tierType!: FeeTierType;

  @Column({ length: 100 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  /**
   * Fee rate as a decimal string (e.g., '0.001' for 0.1%)
   */
  @Column({
    name: 'fee_rate',
    type: 'decimal',
    precision: 8,
    scale: 6,
    default: '0.001',
  })
  feeRate!: string;

  /**
   * Minimum trade volume (in USD) required to qualify for this tier
   */
  @Column({
    name: 'min_volume',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: '0',
  })
  minVolume!: string;

  /**
   * Maximum trade volume (in USD) - null means no upper limit
   */
  @Column({
    name: 'max_volume',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  maxVolume?: string;

  /**
   * Minimum number of trades required to qualify for this tier
   */
  @Column({ name: 'min_trades', type: 'int', default: 0 })
  minTrades!: number;

  /**
   * Whether this tier requires VIP/beta status
   */
  @Column({ name: 'requires_vip', default: false })
  requiresVip!: boolean;

  /**
   * Sort order for display purposes
   */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'is_default', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
