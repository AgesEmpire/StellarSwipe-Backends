import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export enum UserTier {
  BASIC = 'basic',
  VERIFIED = 'verified',
  PREMIUM = 'premium',
}

export enum LimitType {
  DAILY_VOLUME = 'daily_volume',
  WEEKLY_VOLUME = 'weekly_volume',
  HOURLY_TRADES = 'hourly_trades',
  DAILY_TRADES = 'daily_trades',
}

@Entity('transaction_limits')
@Index(['userId', 'limitType'], { unique: true })
export class TransactionLimit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  userId: string;

  @Column({
    type: 'enum',
    enum: UserTier,
    default: UserTier.BASIC,
  })
  userTier: UserTier;

  @Column({
    type: 'enum',
    enum: LimitType,
  })
  limitType: LimitType;

  @Column('decimal', { precision: 20, scale: 8 })
  limitValue: string;

  @Column('decimal', { precision: 20, scale: 8, default: '0' })
  currentUsage: string;

  @Column({ type: 'timestamp', nullable: true })
  lastResetAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  coolingOffUntil: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}