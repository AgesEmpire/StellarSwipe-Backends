import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { BetaUser } from './beta-user.entity';

export enum InviteCodeStatus {
  ACTIVE = 'active',
  USED = 'used',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Entity('invite_codes')
export class InviteCode {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, length: 16 })
  @Index()
  code!: string;

  @Column({
    type: 'enum',
    enum: InviteCodeStatus,
    default: InviteCodeStatus.ACTIVE,
  })
  status!: InviteCodeStatus;

  @Column({ name: 'max_uses', default: 1 })
  maxUses!: number;

  @Column({ name: 'current_uses', default: 0 })
  currentUses!: number;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string;

  @ManyToOne(() => BetaUser, { nullable: true })
  @JoinColumn({ name: 'created_by_user_id' })
  createdByUser?: BetaUser;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
