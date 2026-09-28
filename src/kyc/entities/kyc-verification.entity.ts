import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { encryptedColumn } from '../../security/encrypted-column.transformer';

export enum KycStatus {
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
  REQUIRES_ACTION = 'requires_action',
}

export enum KycLevel {
  NONE = 0,
  BASIC = 1,
  ENHANCED = 2,
}

export enum KycProvider {
  PERSONA = 'persona',
  ONFIDO = 'onfido',
}

export const KYC_MONTHLY_LIMITS: Record<KycLevel, number | null> = {
  [KycLevel.NONE]: 1_000,
  [KycLevel.BASIC]: 10_000,
  [KycLevel.ENHANCED]: null, // unlimited
};

/**
 * Statuses from which a verification may transition to EXPIRED.
 * Terminal states (already expired, rejected) are excluded so that
 * replayed expiry events are idempotent and do not re-trigger
 * status changes or user notifications.
 */
export const KYC_EXPIRABLE_STATUSES: readonly KycStatus[] = [
  KycStatus.PENDING,
  KycStatus.UNDER_REVIEW,
  KycStatus.APPROVED,
  KycStatus.REQUIRES_ACTION,
];

@Entity('kyc_verifications')
@Index(['userId', 'level'])
@Index(['status', 'expiresAt'])
export class KycVerification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  /**
   * Verification level achieved.
   * 0 = No KYC, 1 = Basic, 2 = Enhanced
   */
  @Column({ type: 'int', default: KycLevel.NONE })
  level: KycLevel;

  @Column({
    type: 'enum',
    enum: KycStatus,
    default: KycStatus.PENDING,
  })
  status: KycStatus;

  @Column({
    type: 'enum',
    enum: KycProvider,
    default: KycProvider.PERSONA,
  })
  provider: KycProvider;

  /**
   * External verification ID from Persona / Onfido.
   * We store the reference ID only — never raw documents.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  verificationId: string | null;

  /** Persona inquiry ID (for widget session resumption) */
  @Column({ type: 'varchar', length: 255, nullable: true, transformer: encryptedColumn() })
  inquiryId: string | null;

  /** Session token for the Persona embedded flow */
  @Column({ type: 'text', nullable: true, transformer: encryptedColumn() })
  sessionToken: string | null;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  /** Verifications expire after 1 year — user must re-verify */
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

  /**
   * When the user was notified that this verification expired.
   * Null until the expiry notification has been dispatched; used to
   * guarantee the user is notified at most once per expiry.
   */
  @Column({ type: 'timestamp', nullable: true })
  expiryNotifiedAt: Date | null;

  /** Rejection reason from the provider */
  @Column({ type: 'text', nullable: true })
  rejectionReason: string | null;

  /** Raw webhook payload reference (for audit, not PII) */
  @Column({ type: 'jsonb', default: '{}' })
  providerMetadata: Record<string, unknown>;

  /** Number of verification attempts by the user */
  @Column({ type: 'int', default: 1 })
  attemptCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Whether this verification can still transition to EXPIRED.
   * Returns false for terminal states so replayed expiry events are
   * idempotent and do not re-apply restrictions or re-notify.
   */
  canExpire(): boolean {
    return KYC_EXPIRABLE_STATUSES.includes(this.status);
  }

  /**
   * Whether the user still needs to be notified about this expiry.
   * Guards against duplicate notifications on replayed events.
   */
  needsExpiryNotification(): boolean {
    return this.status === KycStatus.EXPIRED && this.expiryNotifiedAt === null;
  }
}
