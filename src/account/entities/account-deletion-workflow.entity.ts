import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Ordered steps of the account deletion workflow. The order here is the
 * canonical execution order; each step is persisted so a failed run can be
 * resumed without re-executing already-completed steps.
 */
export enum AccountDeletionStep {
  REVOKE_SESSIONS = 'revoke_sessions',
  ANONYMIZE_PROFILE = 'anonymize_profile',
  DELETE_PERSONAL_DATA = 'delete_personal_data',
  APPLY_RETENTION_POLICY = 'apply_retention_policy',
  FINALIZE_DELETION = 'finalize_deletion',
}

export const ACCOUNT_DELETION_STEP_ORDER: AccountDeletionStep[] = [
  AccountDeletionStep.REVOKE_SESSIONS,
  AccountDeletionStep.ANONYMIZE_PROFILE,
  AccountDeletionStep.DELETE_PERSONAL_DATA,
  AccountDeletionStep.APPLY_RETENTION_POLICY,
  AccountDeletionStep.FINALIZE_DELETION,
];

export enum AccountDeletionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum AccountDeletionStepStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export interface AccountDeletionStepState {
  step: AccountDeletionStep;
  status: AccountDeletionStepStatus;
  attempts: number;
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
}

/**
 * Durable, resumable record of an account deletion. Each step's state is
 * persisted so a retried workflow resumes from the first non-completed step
 * instead of duplicating side effects. The audit trail (actor, reason,
 * timestamps, per-step errors) is retained per policy.
 */
@Entity('account_deletion_workflows')
@Index(['accountId', 'status'])
export class AccountDeletionWorkflow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  @Index()
  accountId: string;

  @Column({
    type: 'enum',
    enum: AccountDeletionStatus,
    default: AccountDeletionStatus.PENDING,
  })
  status: AccountDeletionStatus;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  steps: AccountDeletionStepState[];

  @Column({ type: 'int', default: 0 })
  currentStepIndex: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  requestedBy: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  reason: string | null;

  @Column({ type: 'boolean', default: false })
  retentionApplied: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptedAt: Date | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
