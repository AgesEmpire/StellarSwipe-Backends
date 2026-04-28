import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FeatureTrackerService } from '../feature-tracker.service';

@Injectable()
export class AggregateFeatureUsageJob {
  private readonly logger = new Logger(AggregateFeatureUsageJob.name);
  private isRunning = false;

  constructor(private readonly featureTrackerService: FeatureTrackerService) {}

  /**
   * Aggregate yesterday's feature usage into the adoption table nightly.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleNightlyAggregation(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Feature usage aggregation already running — skipping.');
      return;
    }

    this.isRunning = true;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    this.logger.log(
      `Starting feature usage aggregation for ${yesterday.toISOString().split('T')[0]}...`,
    );

    try {
      const result =
        await this.featureTrackerService.aggregateDailyAdoption(yesterday);
      this.logger.log(
        `Aggregation complete. Features upserted: ${result.upserted}`,
      );
    } catch (err) {
      this.logger.error(
        'Feature usage aggregation failed.',
        (err as Error).stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Also run for the current day every 6 hours so dashboards stay current.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async handleIntradayAggregation(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    const today = new Date();
    this.logger.log(
      `Intraday feature usage aggregation for ${today.toISOString().split('T')[0]}...`,
    );

    try {
      const result =
        await this.featureTrackerService.aggregateDailyAdoption(today);
      this.logger.log(
        `Intraday aggregation complete. Features upserted: ${result.upserted}`,
      );
    } catch (err) {
      this.logger.error('Intraday aggregation failed.', (err as Error).stack);
    } finally {
      this.isRunning = false;
    }
  }
}
