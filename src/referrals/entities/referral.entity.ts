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

export enum ReferralStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  REWARDED = 'rewarded',
}

@Entity('referrals')
export class Referral {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'referrer_id', type: 'uuid' })
  @Index()
  referrerId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'referrer_id' })
  referrer!: User;

  @Column({ name: 'referred_id', type: 'uuid' })
  @Index()
  referredId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'referred_id' })
  referred!: User;

  @Column({ name: 'referral_code', length: 8 })
  @Index()
  referralCode!: string;

  @Column({
    type: 'enum',
    enum: ReferralStatus,
    default: ReferralStatus.PENDING,
  })
  status!: ReferralStatus;

  @Column({ name: 'reward_amount', type: 'decimal', precision: 18, scale: 7, default: '5.0000000' })
  rewardAmount!: string;

  @Column({ name: 'first_trade_id', type: 'uuid', nullable: true })
  firstTradeId?: string;

  @Column({ name: 'rewarded_at', type: 'timestamp', nullable: true })
  rewardedAt?: Date;

  @Column({ name: 'reward_tx_hash', type: 'varchar', length: 128, nullable: true })
  rewardTxHash?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
