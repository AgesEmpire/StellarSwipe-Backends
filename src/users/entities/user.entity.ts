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
import { encryptedColumn } from '../../security/encrypted-column.transformer';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  username!: string;

  /** Encrypted at rest — PII (email address). */
  @Column({ unique: true, nullable: true, transformer: encryptedColumn() })
  email?: string;

  @Column({ unique: true, nullable: true, length: 56 })
  walletAddress?: string;

  /** Encrypted at rest — PII (display name). */
  @Column({ nullable: true, length: 500, transformer: encryptedColumn() })
  displayName?: string;

  /** Encrypted at rest — PII (user bio). */
  @Column({ nullable: true, type: 'text', transformer: encryptedColumn() })
  bio?: string;

  @Column({ default: true })
  isActive!: boolean;

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
