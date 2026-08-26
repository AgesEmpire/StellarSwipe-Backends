import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type SubmittedOperationStatus =
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'expired';

/**
 * Tracks every Stellar operation submitted by the backend so the
 * reconciliation job can correlate local records with Horizon outcomes.
 */
@Index('idx_submitted_ops_status_submitted', ['status', 'submittedAt'])
@Entity('submitted_operations')
export class SubmittedOperation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Stellar transaction hash returned by Horizon after submission. */
  @Index({ unique: true })
  @Column({ name: 'tx_hash', length: 128 })
  txHash!: string;

  @Column({
    name: 'status',
    type: 'varchar',
    length: 20,
    default: 'pending',
  })
  status!: SubmittedOperationStatus;

  /** User or internal account that initiated the operation. */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string;

  /** Operation type label for diagnostics (e.g. "payment", "trade"). */
  @Column({ name: 'operation_type', length: 64, nullable: true })
  operationType?: string;

  /** Amount involved, stored as string to preserve Stellar decimal precision. */
  @Column({ name: 'amount', length: 40, nullable: true })
  amount?: string;

  /** Asset code (XLM or issued asset). */
  @Column({ name: 'asset_code', length: 20, nullable: true })
  assetCode?: string;

  @Column({ name: 'submitted_at', type: 'timestamp' })
  submittedAt!: Date;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt?: Date;

  /** Horizon result_xdr or short error description. */
  @Column({ name: 'error_detail', type: 'text', nullable: true })
  errorDetail?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
