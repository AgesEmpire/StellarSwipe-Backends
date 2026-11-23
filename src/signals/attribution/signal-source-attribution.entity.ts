import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Immutable snapshot of one upstream source's contribution to a specific
 * published signal version (#1515). Rows are append-only: a correction or
 * source removal writes a new signal version's attribution set instead of
 * editing earlier rows, and nothing is ever derived from live provider state.
 */
@Entity('signal_source_attributions')
@Unique('uq_signal_source_attribution_version_source', ['signalId', 'signalVersion', 'sourceId'])
@Index('idx_signal_source_attribution_signal_version', ['signalId', 'signalVersion'])
export class SignalSourceAttribution {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'signal_id', type: 'uuid' })
  signalId!: string;

  @Column({ name: 'signal_version', type: 'int' })
  signalVersion!: number;

  /** Internal upstream identifier — never exposed publicly. */
  @Column({ name: 'source_id', type: 'varchar', length: 128 })
  sourceId!: string;

  @Column({ name: 'source_type', type: 'varchar', length: 64 })
  sourceType!: string;

  /** Display label approved for public responses. */
  @Column({ name: 'public_label', type: 'varchar', length: 128, nullable: true })
  publicLabel!: string | null;

  /** Whether this source may be named in public responses. */
  @Column({ name: 'is_public', type: 'boolean', default: false })
  isPublic!: boolean;

  /** Share of the aggregate signal in (0, 1]; a version's weights sum to 1. */
  @Column({ name: 'contribution_weight', type: 'decimal', precision: 7, scale: 6 })
  contributionWeight!: string;

  /** Internal contribution metadata (scores, raw refs) — internal only. */
  @Column({ name: 'contribution_metadata', type: 'jsonb', nullable: true })
  contributionMetadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamp with time zone' })
  recordedAt!: Date;
}
