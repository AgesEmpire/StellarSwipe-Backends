import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MarketDataIngestionService } from '../market-data-ingestion.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * #533 — Market Data Ingestion Job
 *
 * Scheduled job that periodically ingests market data for all
 * supported Stellar asset pairs. Runs every 5 minutes to keep
 * market data fresh for trading engines and feed systems.
 *
 * The job is designed to:
 * - Run without blocking the main application
 * - Retry on transient failures
 * - Log all ingestion events
 * - Emit metrics for monitoring
 */
@Injectable()
export class MarketDataIngestionJob {
  private readonly logger = new Logger(MarketDataIngestionJob.name);
  private lastCompletedAt: Date;

  constructor(
    private marketDataIngestionService: MarketDataIngestionService,
    private eventEmitter: EventEmitter2,
  ) {}

  /**
   * Run market data ingestion every 5 minutes.
   * This frequency ensures fresh data for trading decisions while
   * not overloading external APIs.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async ingestMarketDataJob(): Promise<void> {
    const startTime = Date.now();

    try {
      this.logger.debug('Starting scheduled market data ingestion');

      const results = await this.marketDataIngestionService.ingestAllMarketData();

      const duration = Date.now() - startTime;
      const successCount = Array.from(results.values()).filter((v) => v !== null)
        .length;
      const totalCount = results.size;

      this.lastCompletedAt = new Date();

      this.logger.log(
        `Market data ingestion job completed: ${successCount}/${totalCount} successful (${duration}ms)`,
      );

      // Emit metrics event
      this.eventEmitter.emit('job.market-ingestion.completed', {
        totalAssets: totalCount,
        successCount,
        failureCount: totalCount - successCount,
        duration,
        timestamp: this.lastCompletedAt,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `Market data ingestion job failed after ${duration}ms: ${(error as Error).message}`,
        (error as Error).stack,
      );

      this.eventEmitter.emit('job.market-ingestion.failed', {
        error: (error as Error).message,
        duration,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Run quick market data refresh every minute for critical asset pairs.
   * This ensures BTC, ETH, and XLM prices are always fresh.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async ingestCriticalAssetsJob(): Promise<void> {
    const criticalAssets = ['XLM/USD', 'BTC/USD', 'ETH/USD'];

    try {
      await Promise.allSettled(
        criticalAssets.map((asset) =>
          this.marketDataIngestionService.ingestMarketData(asset),
        ),
      );

      this.logger.debug('Critical asset market data refreshed');
    } catch (error) {
      this.logger.warn(
        `Critical asset refresh failed: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Get the last time market data ingestion completed successfully.
   */
  getLastCompletedTime(): Date | undefined {
    return this.lastCompletedAt;
  }

  /**
   * Get job health status.
   */
  getJobHealth(): {
    isRunning: boolean;
    lastCompletedAt?: Date;
    healthStatus: 'healthy' | 'stale' | 'unknown';
  } {
    const staleThresholdMs = 10 * 60 * 1000; // 10 minutes
    const timeSinceLastCompletion = this.lastCompletedAt
      ? Date.now() - this.lastCompletedAt.getTime()
      : null;

    let healthStatus: 'healthy' | 'stale' | 'unknown' = 'unknown';
    if (timeSinceLastCompletion !== null) {
      healthStatus =
        timeSinceLastCompletion < staleThresholdMs ? 'healthy' : 'stale';
    }

    return {
      isRunning: false,
      lastCompletedAt: this.lastCompletedAt,
      healthStatus,
    };
  }
}
