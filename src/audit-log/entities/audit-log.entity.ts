import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  BeforeUpdate,
  BeforeRemove,
} from 'typeorm';

export enum AuditAction {
  // Authentication
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  TWO_FA_ENABLED = 'TWO_FA_ENABLED',
  TWO_FA_DISABLED = 'TWO_FA_DISABLED',

  // Trading
  TRADE_EXECUTED = 'TRADE_EXECUTED',
  TRADE_CANCELLED = 'TRADE_CANCELLED',
  TRADE_MODIFIED = 'TRADE_MODIFIED',

  // Signals
  SIGNAL_CREATED = 'SIGNAL_CREATED',
  SIGNAL_UPDATED = 'SIGNAL_UPDATED',
  SIGNAL_DELETED = 'SIGNAL_DELETED',

  // Profile & Settings
  SETTINGS_UPDATED = 'SETTINGS_UPDATED',
  PROFILE_UPDATED = 'PROFILE_UPDATED',

  // KYC
  KYC_SUBMITTED = 'KYC_SUBMITTED',
  KYC_APPROVED = 'KYC_APPROVED',
  KYC_REJECTED = 'KYC_REJECTED',
  KYC_MANUAL_REVIEW = 'KYC_MANUAL_REVIEW',

  // Payouts
  PAYOUT_REQUESTED = 'PAYOUT_REQUESTED',
  PAYOUT_APPROVED = 'PAYOUT_APPROVED',
  PAYOUT_REJECTED = 'PAYOUT_REJECTED',
  PAYOUT_PROCESSED = 'PAYOUT_PROCESSED',

  // Admin
  USER_SUSPENDED = 'USER_SUSPENDED',
  USER_REINSTATED = 'USER_REINSTATED',
  ROLE_CHANGED = 'ROLE_CHANGED',
  ADMIN_DATA_EXPORT = 'ADMIN_DATA_EXPORT',

  // Bulk Exports
  BULK_EXPORT_INITIATED = 'BULK_EXPORT_INITIATED',
  BULK_EXPORT_DOWNLOADED = 'BULK_EXPORT_DOWNLOADED',

  // API Keys
  API_KEY_CREATED = 'API_KEY_CREATED',
  API_KEY_ROTATED = 'API_KEY_ROTATED',
  API_KEY_REVOKED = 'API_KEY_REVOKED',
  API_KEY_USED = 'API_KEY_USED',

  // Feature Flags
  FEATURE_FLAG_CREATED = 'FEATURE_FLAG_CREATED',
  FEATURE_FLAG_UPDATED = 'FEATURE_FLAG_UPDATED',
  FEATURE_FLAG_DELETED = 'FEATURE_FLAG_DELETED',

  // System
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  SUSPICIOUS_ACTIVITY = 'SUSPICIOUS_ACTIVITY',
}

export enum AuditStatus {
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
  PARTIAL = 'PARTIAL',
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', nullable: true })
  userId: string;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ nullable: true })
  resource: string;

  @Column({ name: 'resource_id', nullable: true })
  resourceId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ name: 'ip_address', nullable: true })
  ipAddress: string;

  @Column({ name: 'user_agent', nullable: true })
  userAgent: string;

  @Column({ type: 'enum', enum: AuditStatus, default: AuditStatus.SUCCESS })
  status: AuditStatus;

  @Column({ name: 'error_message', nullable: true })
  errorMessage: string;

  @Column({ name: 'session_id', nullable: true })
  sessionId: string;

  @Column({ name: 'request_id', nullable: true })
  requestId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @BeforeUpdate()
  preventUpdate() {
    throw new Error('Audit logs are immutable and cannot be updated');
  }

  @BeforeRemove()
  preventRemove() {
    throw new Error('Audit logs are immutable and cannot be deleted');
  }
}
