import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum KycAuditAction {
  INITIATED = 'initiated',
  DOCUMENT_SUBMITTED = 'document_submitted',
  STATUS_CHANGED = 'status_changed',
  LEVEL_UPGRADED = 'level_upgraded',
  LEVEL_DOWNGRADED = 'level_downgraded',
  EXPIRED = 'expired',
  RENEWAL_STARTED = 'renewal_started',
  WEBHOOK_RECEIVED = 'webhook_received',
  LIMIT_CHECKED = 'limit_checked',
  LIMIT_EXCEEDED = 'limit_exceeded',
}

@Entity('kyc_audit_logs')
@Index(['userId', 'createdAt'])
@Index(['action', 'createdAt'])
export class KycAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  userId: string;

  @Column({ type: 'uuid', nullable: true })
  verificationId: string | null;

  @Column({
    type: 'enum',
    enum: KycAuditAction,
  })
  action: KycAuditAction;

  @Column({ type: 'jsonb', default: '{}' })
  details: Record<string, unknown>;

  /** IP address of the actor (for compliance) */
  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
