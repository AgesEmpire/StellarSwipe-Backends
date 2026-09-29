import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Persisted refresh token record supporting rotation and revocation.
 *
 * Only a hash of the token is stored so a database leak does not expose
 * usable refresh tokens. Each successful refresh rotates the token: the
 * current record is marked as rotated/revoked and a new record is issued.
 * Reuse of an already-rotated token is detectable via `rotatedAt`.
 *
 * Tokens are grouped into a "family" (see `familyId`). When reuse of a
 * rotated token is detected the entire family is revoked, invalidating
 * every descendant token/session issued from the same login.
 */
@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  /**
   * Identifier shared by every token in a rotation chain. The first token
   * of a login starts a new family; each rotated token inherits the family
   * id of the token it replaced. Used to revoke all sessions on reuse.
   */
  @Index()
  @Column({ type: 'uuid' })
  familyId: string;

  /** SHA-256 hash of the opaque refresh token value. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  tokenHash: string;

  /** Optional link to the token this one replaced, for rotation chains. */
  @Column({ type: 'uuid', nullable: true })
  replacedByTokenId: string | null;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'boolean', default: false })
  revoked: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  rotatedAt: Date | null;

  /**
   * Set when this token was presented after it had already been rotated,
   * indicating a replay. Recorded for auditing alongside family revocation.
   */
  @Column({ type: 'timestamptz', nullable: true })
  reuseDetectedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;

  /** True when the token can no longer be used (expired, revoked or rotated). */
  isUsable(now: Date = new Date()): boolean {
    return !this.revoked && this.rotatedAt === null && this.expiresAt > now;
  }

  /**
   * True when this token has already been rotated, meaning any further
   * presentation of it is a replay of a consumed token.
   */
  isReplayed(): boolean {
    return this.rotatedAt !== null;
  }
}
