import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Minimal shape of a soft-deletable record the worker operates on.
 * Kept structural so any repository/entity implementing it can be archived.
 */
export interface SoftDeletableRecord {
  id: string;
  deletedAt: Date | null;
  legalHold?: boolean;
}

/**
 * Persistence contract the archival worker depends on. Implementations are
 * expected to be idempotent: archiving an already-archived record is a no-op.
 */
export interface ArchivalRepository<T extends SoftDeletableRecord> {
  /** Records that are soft-deleted (deletedAt != null) and not yet archived. */
  findArchivableCandidates(limit: number): Promise<T[]>;
  /** Move a single record to archival storage. Must be idempotent. */
  archive(record: T): Promise<void>;
  /** Record a failed archival attempt for auditability/retry. */
  recordFailure(record: T, error: Error): Promise<void>;
}

export interface ArchivalRunSummary {
  scanned: number;
  archived: number;
  skippedLegalHold: number;
  skippedRetention: number;
  failed: number;
}

/**
 * Scheduled worker that archives eligible soft-deleted records.
 *
 * Guarantees:
 *  - Only soft-deleted records are considered (active records are never moved).
 *  - Retention period must be exceeded before a record becomes eligible.
 *  - Records under legal hold are always skipped.
 *  - Archival is idempotent and failures are recorded for retry.
 */
@Injectable()
export class ArchivalWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ArchivalWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly repository: ArchivalRepository<SoftDeletableRecord>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.isEnabled()) {
      this.logger.log('Archival worker disabled by configuration');
      return;
    }
    const intervalMs = this.getIntervalMs();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    // Do not keep the process alive solely for the archival timer.
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    this.logger.log(`Archival worker scheduled every ${intervalMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Runs a single archival pass. Safe to call concurrently: overlapping runs
   * are skipped so archival stays idempotent under a scheduler.
   */
  async runOnce(now: Date = new Date()): Promise<ArchivalRunSummary> {
    const summary: ArchivalRunSummary = {
      scanned: 0,
      archived: 0,
      skippedLegalHold: 0,
      skippedRetention: 0,
      failed: 0,
    };

    if (this.running) {
      this.logger.warn('Archival run already in progress; skipping this tick');
      return summary;
    }
    this.running = true;

    try {
      const batchSize = this.getBatchSize();
      const retentionMs = this.getRetentionMs();
      const candidates = await this.repository.findArchivableCandidates(batchSize);
      summary.scanned = candidates.length;

      for (const record of candidates) {
        // Never move active records: require an explicit soft-delete marker.
        if (!record.deletedAt) {
          continue;
        }

        // Legal hold always wins over retention eligibility.
        if (record.legalHold) {
          summary.skippedLegalHold += 1;
          continue;
        }

        // Retention: only archive once the soft-delete age exceeds retention.
        const ageMs = now.getTime() - new Date(record.deletedAt).getTime();
        if (ageMs < retentionMs) {
          summary.skippedRetention += 1;
          continue;
        }

        try {
          await this.repository.archive(record);
          summary.archived += 1;
        } catch (error) {
          summary.failed += 1;
          const err = error instanceof Error ? error : new Error(String(error));
          this.logger.error(`Failed to archive record ${record.id}: ${err.message}`);
          try {
            await this.repository.recordFailure(record, err);
          } catch (recordError) {
            const recErr =
              recordError instanceof Error ? recordError : new Error(String(recordError));
            this.logger.error(
              `Failed to record archival failure for ${record.id}: ${recErr.message}`,
            );
          }
        }
      }

      this.logger.log(
        `Archival run complete: scanned=${summary.scanned} archived=${summary.archived} ` +
          `skippedLegalHold=${summary.skippedLegalHold} skippedRetention=${summary.skippedRetention} ` +
          `failed=${summary.failed}`,
      );
      return summary;
    } finally {
      this.running = false;
    }
  }

  private isEnabled(): boolean {
    return this.config.get<boolean>('archival.enabled') ?? true;
  }

  private getIntervalMs(): number {
    const seconds = this.config.get<number>('archival.intervalSeconds') ?? 3600;
    return Math.max(seconds, 1) * 1000;
  }

  private getBatchSize(): number {
    return this.config.get<number>('archival.batchSize') ?? 100;
  }

  private getRetentionMs(): number {
    const days = this.config.get<number>('archival.retentionDays') ?? 30;
    return Math.max(days, 0) * 24 * 60 * 60 * 1000;
  }
}
