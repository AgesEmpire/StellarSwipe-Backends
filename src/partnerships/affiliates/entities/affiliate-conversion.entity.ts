import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Affiliate } from './affiliate.entity';

export enum ConversionStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid',
}

export enum ConversionType {
  SIGNUP = 'signup',
  SUBSCRIPTION = 'subscription',
  TRADE = 'trade',
  DEPOSIT = 'deposit',
}

@Entity('affiliate_conversions')
export class AffiliateConversion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  affiliateId: string;

  @Column()
  referredUserId: string;

  @Column({ type: 'enum', enum: ConversionType })
  conversionType: ConversionType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  conversionValue: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  commissionAmount: number;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  commissionRate: number;

  @Column({ type: 'int', default: 1 })
  tier: number;

  @Column({ type: 'enum', enum: ConversionStatus, default: ConversionStatus.PENDING })
  status: ConversionStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata: {
    subscriptionPlan?: string;
    tradeAmount?: number;
    depositAmount?: number;
    [key: string]: any;
  };

  @Column({ nullable: true })
  approvedAt: Date;

  @Column({ nullable: true })
  paidAt: Date;

  @ManyToOne(() => Affiliate, affiliate => affiliate.conversions)
  @JoinColumn({ name: 'affiliateId' })
  affiliate: Affiliate;

  @CreateDateColumn()
  createdAt: Date;
}
