import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

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
  @Column({ type: 'varchar', length: 255, nullable: true })
  inquiryId: string | null;

  /** Session token for the Persona embedded flow */
  @Column({ type: 'varchar', length: 1000, nullable: true })
  sessionToken: string | null;

  @Column({ type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  /** Verifications expire after 1 year — user must re-verify */
  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date | null;

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
}
