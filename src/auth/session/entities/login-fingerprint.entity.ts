import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Stores a hashed device/network fingerprint observed at a successful
 * login, so future logins for the same user can be compared against
 * recent history to detect anomalous (new device/IP/UA) sign-ins.
 */
@Index('idx_login_fingerprints_user_hash', ['userId', 'fingerprintHash'])
@Index('idx_login_fingerprints_user_created', ['userId', 'createdAt'])
@Entity('login_fingerprints')
export class LoginFingerprint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** SHA-256 hash of the normalized IP + user-agent (+ optional signals). */
  @Column({ name: 'fingerprint_hash', length: 64 })
  fingerprintHash!: string;

  @Column({ name: 'ip_address', nullable: true })
  ipAddress?: string;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent?: string;

  @Column({ name: 'accept_language', nullable: true })
  acceptLanguage?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
