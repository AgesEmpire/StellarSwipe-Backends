import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum WaitlistStatus {
  PENDING = 'pending',
  INVITED = 'invited',
  JOINED = 'joined',
  REMOVED = 'removed',
}

@Entity('waitlist')
export class Waitlist {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, length: 255 })
  @Index()
  email!: string;

  @Column({
    type: 'enum',
    enum: WaitlistStatus,
    default: WaitlistStatus.PENDING,
  })
  status!: WaitlistStatus;

  @Column({ default: 0 })
  @Index()
  position!: number;

  @Column({ name: 'referral_code', type: 'varchar', length: 16, nullable: true })
  @Index()
  referralCode?: string;

  @Column({ name: 'referred_by_code', type: 'varchar', length: 16, nullable: true })
  referredByCode?: string;

  @Column({ name: 'referral_count', default: 0 })
  referralCount!: number;

  @Column({ name: 'invite_code_sent', type: 'varchar', length: 16, nullable: true })
  inviteCodeSent?: string;

  @Column({ name: 'invited_at', type: 'timestamp', nullable: true })
  invitedAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
