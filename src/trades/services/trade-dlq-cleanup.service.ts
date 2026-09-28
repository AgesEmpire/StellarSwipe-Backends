import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Trade, TradeStatus } from '../entities/trade.entity';
import { DeadLetterService } from '../../jobs/dead-letter.service';
import { TradeDlqMetricsService } from './trade-dlq-metrics.service';

export interface CleanupResult {
  archivedCount: number;
  dlqEntriesRemoved: number;
  errors: string[];
  durationMs: number;
}

/**
 * #999 -- Scheduled cleanup service for the trade DLQ.
 *
 * Runs daily to:
 * 1. Archive old FAILED trades that have been discarded and exceed retention
 * 2. Remove stale DLQ entries from the Bull dead-letter queue
 * 3. Sync DLQ depth metrics
 */
@Injectable()
export class TradeDlqCleanupService {
  private readonly logger = new Logger(TradeDlqCleanupService.name);
  private readonly retentionDays: number;
  private lastCleanupResult: CleanupResult | null = null;
  private lastCleanupAt: Date | null = null;

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    private readonly deadLetterService: DeadLetterService,
    private readonly metricsService: TradeDlqMetricsService,
    private readonly configService: ConfigService,
  ) {
    this.retentionDays = this.configService.get<number>(
      'dlq.retentionDays',
      90,
    );
  }

  /**
   * Daily cleanup job. Runs at 3 AM to avoid peak hours.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDailyCleanup(): Promise<void> {
    this.logger.log('Starting daily DLQ cleanup job');
    try {
      const result = await this.cleanupOldEntries(this.retentionDays);
      this.lastCleanupResult = result;
      this.lastCleanupAt = new Date();

      this.logger.log(
        `DLQ cleanup completed in ${result.durationMs}ms: ` +
        `archived=${result.archivedCount}, dlqRemoved=${result.dlqEntriesRemoved}, ` +
        `errors=${result.errors.length}`,
      );
    } catch (error: any) {
      this.logger.error(`DLQ cleanup failed: ${error.message}`, error.stack);
    }

    // Sync DLQ depth metrics after cleanup
    await this.syncDlqDepth();
  }

  /**
   * Archive old DLQ entries that exceed the retention period.
   */
  async cleanupOldEntries(retentionDays: number): Promise<CleanupResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let archivedCount = 0;
    let dlqEntriesRemoved = 0;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // 1. Find old failed trades that have been discarded
    const oldDiscardedTrades = await this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.status = :status', { status: TradeStatus.FAILED })
      .andWhere('trade.updatedAt < :cutoff', { cutoff: cutoffDate })
      .andWhere("trade.metadata->>'discarded' IS NOT NULL")
      .getMany();

    this.logger.debug(
      `Found ${oldDiscardedTrades.length} discarded failed trades older than ${retentionDays} days`,
    );

    // 2. Soft-delete old discarded trades
    for (const trade of oldDiscardedTrades) {
      try {
        trade.metadata = {
          ...trade.metadata,
          archivedAt: new Date().toISOString(),
          archivedReason: `DLQ cleanup: exceeded ${retentionDays}-day retention`,
        };
        await this.tradeRepository.softDelete(trade.id);
        archivedCount++;
      } catch (error: any) {
        const msg = `Failed to archive trade ${trade.id}: ${error.message}`;
        errors.push(msg);
        this.logger.warn(msg);
      }
    }

    // 3. Clean up stale DLQ entries
    try {
      const dlqJobs = await this.deadLetterService.list();
      for (const job of dlqJobs) {
        const failedAt = job.data?.failedAt;
        if (failedAt && new Date(failedAt) < cutoffDate) {
          try {
            await this.deadLetterService.discard(String(job.id));
            dlqEntriesRemoved++;
          } catch (error: any) {
            const msg = `Failed to remove DLQ entry ${job.id}: ${error.message}`;
            errors.push(msg);
            this.logger.warn(msg);
          }
        }
      }
    } catch (error: any) {
      const msg = `Failed to list DLQ jobs for cleanup: ${error.message}`;
      errors.push(msg);
      this.logger.error(msg);
    }

    const durationMs = Date.now() - startTime;

    return {
      archivedCount,
      dlqEntriesRemoved,
      errors,
      durationMs,
    };
  }

  /**
   * Sync the DLQ depth metric with the actual queue state.
   */
  async syncDlqDepth(): Promise<void> {
    try {
      const dlqJobs = await this.deadLetterService.list();
      const tradeDlqJobs = dlqJobs.filter(
        (job) => job.data?.queue === 'transactions',
      );
      this.metricsService.setDlqDepth(tradeDlqJobs.length);
    } catch (error: any) {
      this.logger.warn(`Failed to sync DLQ depth: ${error.message}`);
    }
  }

  /**
   * Get the result of the last cleanup run.
   */
  getLastCleanupResult(): { result: CleanupResult | null; runAt: string | null } {
    return {
      result: this.lastCleanupResult,
      runAt: this.lastCleanupAt?.toISOString() ?? null,
    };
  }

  /**
   * Get current retention configuration.
   */
  getRetentionConfig(): { retentionDays: number; cronExpression: string } {
    return {
      retentionDays: this.retentionDays,
      cronExpression: CronExpression.EVERY_DAY_AT_3AM,
    };
  }
}
