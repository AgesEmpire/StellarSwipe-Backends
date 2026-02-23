import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

export enum UpdateApprovalStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  AUTO_APPLIED = 'auto_applied',
}

@Entity('signal_versions')
export class SignalVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'signal_id' })
  signalId: string;

  @Index()
  @Column({ name: 'provider_address' })
  providerAddress: string;

  @Column({ name: 'version_number' })
  versionNumber: number;

  // Snapshot of values at this version
  @Column({
    name: 'entry_price',
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
  })
  entryPrice: number | null;

  @Column({
    name: 'target_price',
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
  })
  targetPrice: number | null;

  @Column({
    name: 'stop_loss',
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
  })
  stopLoss: number | null;

  @Column({
    name: 'take_profit',
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
  })
  takeProfit: number | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;

  // What changed from the previous version
  @Column({ name: 'change_summary', type: 'text', nullable: true })
  changeSummary: string | null;

  @Column({ name: 'requires_approval', default: false })
  requiresApproval: boolean;

  // Tracks how many copiers approved/rejected/auto-applied this version
  @Column({ name: 'approved_count', default: 0 })
  approvedCount: number;

  @Column({ name: 'rejected_count', default: 0 })
  rejectedCount: number;

  @Column({ name: 'auto_applied_count', default: 0 })
  autoAppliedCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}

@Entity('signal_version_approvals')
export class SignalVersionApproval {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'signal_version_id' })
  signalVersionId: string;

  @Index()
  @Column({ name: 'copier_id' })
  copierId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: UpdateApprovalStatus,
    default: UpdateApprovalStatus.PENDING,
  })
  status: UpdateApprovalStatus;

  @Column({ name: 'auto_adjust', default: false })
  autoAdjust: boolean;

  @CreateDateColumn({ name: 'responded_at' })
  respondedAt: Date;
}
