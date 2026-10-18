import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Durable progress checkpoint for a full search reindex job (e.g.
 * `maintenance:reindex --entity=signals`). Persisting the last processed
 * offset lets an interrupted job resume from where it left off instead of
 * restarting from the beginning, and lets progress be queried while the
 * job is running.
 */
@Entity('search_reindex_checkpoints')
export class SearchReindexCheckpoint {
  /** Name of the reindex job, e.g. "signals" or "users". */
  @PrimaryColumn({ name: 'job_name', type: 'varchar', length: 128 })
  jobName!: string;

  /** Number of records already processed in the current (or last) run. */
  @Column({ name: 'processed', type: 'int', default: 0 })
  processed!: number;

  /** Total number of records expected for the current (or last) run. */
  @Column({ name: 'total', type: 'int', default: 0 })
  total!: number;

  /**
   * Set once the job has run to completion. A fresh `run()` invocation
   * for a completed job starts over from zero rather than treating it as
   * resumable (there is nothing left to resume).
   */
  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt?: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
