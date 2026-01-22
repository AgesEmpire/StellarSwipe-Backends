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

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  username!: string;

  @Column({ unique: true, nullable: true })
  email?: string;

  @Column({ unique: true, length: 56 })
  @Index('idx_users_wallet_address')
  walletAddress!: string;

  @Column({ nullable: true, length: 100 })
  displayName?: string;

  @Column({ nullable: true })
  bio?: string;

  @Column({ default: true })
  isActive!: boolean;

  @Column({ default: 0 })
  reputationScore!: number;

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
