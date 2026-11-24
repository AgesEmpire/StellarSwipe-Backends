import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { ChainObservation } from './chain-confirmation.source';

/**
 * Immutable proof of a state change applied to a pending order by chain
 * reconciliation (#1531) — one row per transition, never updated or deleted
 * (DB trigger, migration 20261123180000).
 */
@Entity('order_reconciliation_evidence')
@Index('IDX_order_reconciliation_evidence_trade', ['tradeId', 'createdAt'])
export class OrderReconciliationEvidence {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'trade_id', type: 'uuid' })
  tradeId!: string;

  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId?: string | null;

  @Column({ name: 'tx_hash', type: 'varchar', length: 128 })
  txHash!: string;

  @Column({ name: 'from_status', type: 'varchar', length: 32 })
  fromStatus!: string;

  @Column({ name: 'to_status', type: 'varchar', length: 32 })
  toStatus!: string;

  /** Policy rule (or operator resolution) that justified the transition. */
  @Column({ type: 'varchar', length: 64 })
  rule!: string;

  @Column({ name: 'policy_version', type: 'varchar', length: 32 })
  policyVersion!: string;

  /** "system" for automated runs, otherwise the operator's user id. */
  @Column({ name: 'actor_id', type: 'varchar', length: 128 })
  actorId!: string;

  @Column({ type: 'text', nullable: true })
  note?: string | null;

  @Column({ type: 'jsonb' })
  observations!: ChainObservation[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export enum ReconciliationReviewStatus {
  OPEN = 'open',
  RESOLVED = 'resolved',
}

export enum ReconciliationResolution {
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
  DISMISSED = 'dismissed',
}

/**
 * An ambiguous or contradictory chain result surfaced for an operator instead
 * of being guessed. At most one open review per order (partial unique index).
 */
@Entity('order_reconciliation_reviews')
@Index('IDX_order_reconciliation_reviews_status', ['status', 'createdAt'])
export class OrderReconciliationReview {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'trade_id', type: 'uuid' })
  tradeId!: string;

  @Column({ name: 'tx_hash', type: 'varchar', length: 128 })
  txHash!: string;

  @Column({ type: 'varchar', length: 64 })
  reason!: string;

  @Column({ type: 'text' })
  detail!: string;

  @Column({ type: 'varchar', length: 16, default: ReconciliationReviewStatus.OPEN })
  status!: ReconciliationReviewStatus;

  /** Latest observations seen for this order (evidence rows hold the immutable history). */
  @Column({ type: 'jsonb' })
  observations!: ChainObservation[];

  @Column({ name: 'first_run_id', type: 'uuid', nullable: true })
  firstRunId?: string | null;

  @Column({ name: 'last_run_id', type: 'uuid', nullable: true })
  lastRunId?: string | null;

  /** How many reconciliation runs have flagged this order while the review was open. */
  @Column({ type: 'int', default: 1 })
  occurrences!: number;

  @Column({ type: 'varchar', length: 16, nullable: true })
  resolution?: ReconciliationResolution | null;

  @Column({ name: 'resolved_by', type: 'varchar', length: 128, nullable: true })
  resolvedBy?: string | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote?: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt?: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
