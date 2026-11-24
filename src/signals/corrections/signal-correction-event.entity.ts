import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Event types on the signal lifecycle stream. Consumers branch on `eventType`
 * to tell an explicit correction apart from a new publication (#1518).
 */
export enum SignalLifecycleEventType {
  PUBLISHED = 'signal.published',
  CORRECTED = 'signal.corrected',
}

/**
 * Append-only record of a provider correcting an already-published signal.
 * Links the version it supersedes to the version that replaces it.
 */
@Entity('signal_correction_events')
@Unique('uq_signal_correction_sequence', ['signalId', 'sequence'])
@Unique('uq_signal_correction_idempotency', ['signalId', 'idempotencyKey'])
@Index('idx_signal_correction_signal_sequence', ['signalId', 'sequence'])
export class SignalCorrectionEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 32, default: SignalLifecycleEventType.CORRECTED })
  eventType!: SignalLifecycleEventType.CORRECTED;

  @Column({ name: 'signal_id', type: 'uuid' })
  signalId!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId!: string;

  /** Monotonic per-signal ordering used for replay. */
  @Column({ name: 'sequence', type: 'int' })
  sequence!: number;

  @Column({ name: 'previous_version_id', type: 'uuid' })
  previousVersionId!: string;

  @Column({ name: 'previous_version_number', type: 'int' })
  previousVersionNumber!: number;

  @Column({ name: 'replacement_version_id', type: 'uuid' })
  replacementVersionId!: string;

  @Column({ name: 'replacement_version_number', type: 'int' })
  replacementVersionNumber!: number;

  @Column({ name: 'reason', type: 'text' })
  reason!: string;

  /** Field-level diff: { field: { from, to } }. */
  @Column({ name: 'changes', type: 'jsonb' })
  changes!: Record<string, { from: string | null; to: string | null }>;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true })
  idempotencyKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}
