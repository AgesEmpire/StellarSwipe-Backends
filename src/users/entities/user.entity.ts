import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  OneToOne,
  Index,
} from 'typeorm';
import { Signal } from '../../signals/entities/signal.entity';
import { Trade } from '../../trades/entities/trade.entity';
import { UserPreference } from './user-preference.entity';
import { Session } from './session.entity';

export enum UserTier {
  BASIC = 'basic',
  SILVER = 'silver',
  GOLD = 'gold',
  PLATINUM = 'platinum',
}

export enum KycStatus {
  NONE = 'none',
  PENDING = 'pending',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  username!: string;

  @Column({ unique: true, nullable: true })
  email?: string;

  @Column({ nullable: true, select: false })
  password?: string;

  @Column({ unique: true, nullable: true, length: 56 })
  walletAddress?: string;

  @Column({ nullable: true, length: 100 })
  displayName?: string;

  @Column({ nullable: true })
  bio?: string;

  @Column({ default: true })
  isActive!: boolean;

  @Column({
    type: 'enum',
    enum: UserTier,
    default: UserTier.BASIC,
  })
  tier!: UserTier;

  @Column({
    type: 'enum',
    enum: KycStatus,
    default: KycStatus.NONE,
  })
  kycStatus!: KycStatus;

  @Column({ default: 0 })
  reputationScore!: number;

  @Column({ name: 'referred_by', type: 'uuid', nullable: true })
  referredBy?: string;

  @Column({ type: 'timestamp', nullable: true })
  lastLoginAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt?: Date;

  @OneToMany(() => Signal, (signal) => signal.provider)
  signals!: Signal[];

  @OneToMany(() => Trade, (trade) => trade.user)
  trades!: Trade[];

  @OneToOne(() => UserPreference, (preference) => preference.user, {
    cascade: true,
  })
  preference?: UserPreference;

  @OneToMany(() => Session, (session) => session.user, {
    cascade: true,
  })
  sessions!: Session[];
}
