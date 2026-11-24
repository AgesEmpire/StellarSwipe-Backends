import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum PositionLifecycleEventType {
  OPENED = 'opened',
  PARTIALLY_CLOSED = 'partially_closed',
  CLOSED = 'closed',
  REOPENED = 'reopened',
  ARCHIVED = 'archived',
}

/** Which model the position lives in. Trade-based positions use the opening trade id as positionId. */
export enum PositionLifecycleSource {
  TRADE = 'trade',
  PORTFOLIO_POSITION = 'portfolio_position',
  API = 'api',
}

/**
 * Immutable timestamp of one position transition (#1534).
 *
 * Rows are append-only (DB trigger blocks UPDATE/DELETE, migration
 * 20261123180000) and are kept even after the position row itself is archived
 * or removed. Quantity columns are informational snapshots: position quantity
 * semantics stay owned by the trade/position models.
 *
 * Timezone semantics: `occurred_at` / `recorded_at` are `timestamptz`, i.e.
 * absolute instants; the API always serializes them as ISO 8601 UTC ("Z").
 */
@Entity('position_lifecycle_events')
@Index('UQ_position_lifecycle_events_position_sequence', ['positionId', 'sequence'], { unique: true })
@Index('UQ_position_lifecycle_events_idempotency', ['idempotencyKey'], { unique: true })
@Index('IDX_position_lifecycle_events_user_occurred', ['userId', 'occurredAt'])
export class PositionLifecycleEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'position_id', type: 'uuid' })
  positionId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType!: PositionLifecycleEventType;

  /** 1-based, gap-free per position; defines event order. */
  @Column({ type: 'int' })
  sequence!: number;

  /** When the transition happened in the business domain (UTC instant). */
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  /** When this row was written (UTC instant). */
  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt!: Date;

  @Column({ name: 'quantity_before', type: 'decimal', precision: 18, scale: 8, nullable: true })
  quantityBefore?: string | null;

  @Column({ name: 'quantity_after', type: 'decimal', precision: 18, scale: 8, nullable: true })
  quantityAfter?: string | null;

  @Column({ type: 'varchar', length: 32 })
  source!: PositionLifecycleSource;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 200 })
  idempotencyKey!: string;

  /**
   * True when the row was back-filled for a position that predates lifecycle
   * tracking (e.g. OPENED inferred from the trade's executedAt on first close).
   */
  @Column({ type: 'boolean', default: false })
  inferred!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;
}
