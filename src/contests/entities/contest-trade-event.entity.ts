import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ContestEventDisposition {
  /** Counted toward live / initially published scores. */
  ACCEPTED = 'ACCEPTED',
  /** Event time outside [startTime, endTime); never counted. */
  EXCLUDED_OUT_OF_WINDOW = 'EXCLUDED_OUT_OF_WINDOW',
  /** In-window but arrived after the cutoff; quarantined until a correction. */
  PENDING_CORRECTION = 'PENDING_CORRECTION',
  /** Applied to published results through an authorized correction. */
  CORRECTION_APPLIED = 'CORRECTION_APPLIED',
}

/** Ledger of trade events seen for a contest (#1524). */
@Entity('contest_trade_events')
@Index(['contestId', 'eventId'], { unique: true })
@Index(['contestId', 'disposition'])
export class ContestTradeEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'contest_id', type: 'uuid' })
  contestId!: string;

  /** Producer-assigned idempotency key; replays reuse the same id. */
  @Column({ name: 'event_id', type: 'varchar', length: 128 })
  eventId!: string;

  @Column({ name: 'provider_id', type: 'uuid' })
  providerId!: string;

  /** When the trade happened (producer clock). */
  @Column({ name: 'event_time', type: 'timestamp with time zone' })
  eventTime!: Date;

  /** When the platform first received the event. */
  @Column({ name: 'ingested_at', type: 'timestamp with time zone' })
  ingestedAt!: Date;

  @Column({ name: 'score_delta', type: 'double precision' })
  scoreDelta!: number;

  @Column({ type: 'varchar', length: 32 })
  disposition!: ContestEventDisposition;

  @Column({ name: 'correction_id', type: 'uuid', nullable: true })
  correctionId?: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}

/** Audit record of an authorized change to published contest results. */
@Entity('contest_result_corrections')
@Index(['contestId', 'toRevision'], { unique: true })
export class ContestResultCorrection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'contest_id', type: 'uuid' })
  contestId!: string;

  @Column({ name: 'actor_id', type: 'varchar', length: 128 })
  actorId!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ name: 'event_ids', type: 'jsonb' })
  eventIds!: string[];

  @Column({ name: 'from_revision', type: 'int' })
  fromRevision!: number;

  @Column({ name: 'to_revision', type: 'int' })
  toRevision!: number;

  @Column({ name: 'previous_scores', type: 'jsonb' })
  previousScores!: Record<string, number>;

  @Column({ name: 'new_scores', type: 'jsonb' })
  newScores!: Record<string, number>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;
}
