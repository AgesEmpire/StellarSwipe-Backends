import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Stores a named cursor so blockchain event ingestion can resume from a
 * safe boundary after a restart or provider interruption.
 *
 * A row is upserted atomically alongside the events it guards, so the
 * cursor and the processed events are always consistent.
 */
@Entity('ingestion_checkpoints')
export class IngestionCheckpoint {
  /** Human-readable key that identifies the ingestion stream. */
  @PrimaryColumn({ type: 'varchar', length: 128 })
  key!: string;

  /**
   * Horizon paging_token of the last fully-processed page.
   * Null means "start from the beginning" (or "now" if no history exists).
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  cursor?: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
