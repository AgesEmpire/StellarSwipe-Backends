import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';

export enum BetaUserStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  REVOKED = 'revoked',
}

@Entity('beta_users')
export class BetaUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, length: 255 })
  @Index()
  email!: string;

  @Column({ name: 'stellar_address', type: 'varchar', length: 56, nullable: true })
  @Index()
  stellarAddress?: string;

  @Column({
    type: 'enum',
    enum: BetaUserStatus,
    default: BetaUserStatus.ACTIVE,
  })
  status!: BetaUserStatus;

  @Column({ name: 'invite_code_used', length: 16 })
  inviteCodeUsed!: string;

  @Column({ name: 'referred_by_user_id', type: 'uuid', nullable: true })
  referredByUserId?: string;

  @ManyToOne(() => BetaUser, (user) => user.referrals, { nullable: true })
  @JoinColumn({ name: 'referred_by_user_id' })
  referredByUser?: BetaUser;

  @OneToMany(() => BetaUser, (user) => user.referredByUser)
  referrals!: BetaUser[];

  @Column({ name: 'referral_count', default: 0 })
  referralCount!: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ name: 'activated_at', type: 'timestamp', nullable: true })
  activatedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
