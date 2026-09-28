import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

/**
 * A record that may be eligible for archival. Records are only ever
 * considered when they carry a soft-delete marker (`deletedAt`).
 */
export interface ArchivableRecord {
  id: string;
  deletedAt: Date | null;
  legalHold?: boolean;
}

/**
 * Persistence contract used by the archival worker. Kept intentionally
 * narrow so it can be backed by any repository implementation.
 */
export interface ArchivalRepository {
  findSoftDeletedBefore(cutoff: Date): Promise<ArchivableRecord[]>;
  archive(record: ArchivableRecord): Promise<void>;
}

export interface ArchivalRunResult {
  scanned: number;
  archived: number;
  skippedLegalHold: number;
  skippedActive: number;
  failures: number;
}

/**
 * Scheduled worker that moves eligible soft-deleted records to archival
 * storage. Archival is idempotent (already-archived records are removed
 * from the source set), respects retention and legal-hold rules, and never
 * touches active (non-soft-deleted) records.
 */
@Injectable()
export class ArchivalService {
  private readonly logger = new Logger(ArchivalService.name);

  /** Retention window in days; soft-deleted records younger than this are kept. */
  private readonly retentionDays: number;

  /** Max attempts per record before it is reported as a failure. */
  private readonly maxRetries: number;

  constructor(
    private readonly repository: ArchivalRepository,
    retentionDays = 30,
    maxRetries = 3,
  ) {
    this.retentionDays = retentionDays;
    this.maxRetries = maxRetries;
  }

  /**
   * Runs on a schedule. Scans for soft-deleted records past the retention
   * window and archives each eligible record.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleScheduledArchival(): Promise<ArchivalRunResult> {
    const result = await this.archiveEligibleRecords();
    this.logger.log(
      `Archival run complete: scanned=${result.scanned} archived=${result.archived} ` +
        `skippedLegalHold=${result.skippedLegalHold} skippedActive=${result.skippedActive} ` +
        `failures=${result.failures}`,
    );
    return result;
  }

  /**
   * Core archival pass. Exposed for manual invocation and recovery tests.
   */
  async archiveEligibleRecords(now: Date = new Date()): Promise<ArchivalRunResult> {
    const cutoff = this.retentionCutoff(now);
    const candidates = await this.repository.findSoftDeletedBefore(cutoff);

    const result: ArchivalRunResult = {
      scanned: candidates.length,
      archived: 0,
      skippedLegalHold: 0,
      skippedActive: 0,
      failures: 0,
    };

    for (const record of candidates) {
      // Never move active records: require an explicit soft-delete marker.
      if (!record.deletedAt) {
        result.skippedActive += 1;
        continue;
      }

      // Respect legal hold regardless of retention eligibility.
      if (record.legalHold) {
        result.skippedLegalHold += 1;
        continue;
      }

      // Enforce retention: only archive records older than the window.
      if (record.deletedAt > cutoff) {
        continue;
      }

      const archived = await this.archiveWithRetry(record);
      if (archived) {
        result.archived += 1;
      } else {
        result.failures += 1;
      }
    }

    return result;
  }

  /**
   * Archives a single record with bounded retries. Idempotent: a record that
   * has already been archived is treated as success by the repository.
   */
  private async archiveWithRetry(record: ArchivableRecord): Promise<boolean> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      try {
        await this.repository.archive(record);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Archival attempt ${attempt}/${this.maxRetries} failed for record ${record.id}: ${message}`,
        );
      }
    }
    this.logger.error(`Archival failed for record ${record.id} after ${this.maxRetries} attempts`);
    return false;
  }

  private retentionCutoff(now: Date): Date {
    const cutoff = new Date(now.getTime());
    cutoff.setDate(cutoff.getDate() - this.retentionDays);
    return cutoff;
  }
}
