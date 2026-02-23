import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { AffiliateConversion } from './affiliate-conversion.entity';

export enum AffiliateStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  TERMINATED = 'terminated',
}

export enum CommissionTier {
  TIER_1 = 'tier_1', // Direct referrals
  TIER_2 = 'tier_2', // Second level
  TIER_3 = 'tier_3', // Third level
}

@Entity('affiliates')
export class Affiliate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  userId: string;

  @Column({ unique: true })
  affiliateCode: string;

  @Column({ type: 'enum', enum: AffiliateStatus, default: AffiliateStatus.PENDING })
  status: AffiliateStatus;

  @Column({ nullable: true })
  parentAffiliateId: string;

  @Column({ type: 'int', default: 1 })
  level: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalEarnings: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  pendingCommission: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  paidCommission: number;

  @Column({ type: 'int', default: 0 })
  totalReferrals: number;

  @Column({ type: 'int', default: 0 })
  activeReferrals: number;

  @Column({ type: 'jsonb', nullable: true })
  commissionRates: {
    tier1: number;
    tier2: number;
    tier3: number;
  };

  @Column({ type: 'jsonb', nullable: true })
  payoutDetails: {
    method: string;
    walletAddress?: string;
    bankAccount?: string;
    email?: string;
  };

  @Column({ nullable: true })
  lastPayoutDate: Date;

  @OneToMany(() => AffiliateConversion, conversion => conversion.affiliate)
  conversions: AffiliateConversion[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
