import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, LessThan } from 'typeorm';
import { DriftDetectorService, FeedSample } from '../drift-detector.service';
import { JobSchedulerService } from '../../../jobs/job-scheduler.service';
import { UserEvent } from '../../entities/user-event.entity';
import { MetricSnapshot } from '../../entities/metric-snapshot.entity';

/**
 * Scheduled job that compares recent trading / market data distributions
 * against a rolling baseline window to detect data drift.
 *
 * Schedule: every hour by default (configurable via CRON_ANALYTICS_DRIFT_DETECTION).
 *
 * Baseline window : previous 7 days
 * Current window  : last 1 hour
 */
@Injectable()
export class DetectDataDriftJob implements OnModuleInit {
  private readonly logger = new Logger(DetectDataDriftJob.name);

  /** How many days of history to use as the baseline */
  private readonly BASELINE_DAYS = 7;
  /** How many hours to use as the current observation window */
  private readonly CURRENT_HOURS = 1;

  constructor(
    @InjectRepository(UserEvent)
    private readonly userEventRepo: Repository<UserEvent>,
    @InjectRepository(MetricSnapshot)
    private readonly metricSnapshotRepo: Repository<MetricSnapshot>,
    private readonly driftDetectorService: DriftDetectorService,
    private readonly scheduler: JobSchedulerService,
  ) {}

  onModuleInit(): void {
    this.scheduler.register({
      name: 'analytics.drift-detection',
      cronEnvKey: 'CRON_ANALYTICS_DRIFT_DETECTION',
      defaultCron: '0 * * * *', // every hour
      handler: () => this.run(),
    });
  }

  async run(): Promise<void> {
    this.logger.log('Starting data drift detection job');

    const now = new Date();
    const currentWindowStart = new Date(now.getTime() - this.CURRENT_HOURS * 60 * 60 * 1000);
    const baselineWindowStart = new Date(now.getTime() - this.BASELINE_DAYS * 24 * 60 * 60 * 1000);

    const samples = await this.buildFeedSamples(
      baselineWindowStart,
      currentWindowStart,
      now,
    );

    if (samples.length === 0) {
      this.logger.warn('No feed samples available for drift detection — skipping');
      return;
    }

    const results = await this.driftDetectorService.detectDrift(samples);

    const driftCount = results.filter((r) => r.isDrift).length;
    this.logger.log(
      `Drift detection job finished: ${results.length} feeds checked, ${driftCount} anomalies detected`,
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Build feed samples by extracting numeric metrics from stored events and
   * metric snapshots, then splitting them into baseline vs. current windows.
   */
  private async buildFeedSamples(
    baselineStart: Date,
    currentStart: Date,
    currentEnd: Date,
  ): Promise<FeedSample[]> {
    const samples: FeedSample[] = [];

    // ── Feed 1: event counts per hour (activity volume) ──────────────────────
    const eventCountSample = await this.buildEventCountSample(
      baselineStart,
      currentStart,
      currentEnd,
    );
    if (eventCountSample) samples.push(eventCountSample);

    // ── Feed 2: daily active user counts from metric snapshots ────────────────
    const dauSample = await this.buildDauSample(baselineStart, currentStart);
    if (dauSample) samples.push(dauSample);

    // ── Feed 3: swipe-to-trade conversion rate ────────────────────────────────
    const conversionSample = await this.buildConversionSample(baselineStart, currentStart);
    if (conversionSample) samples.push(conversionSample);

    return samples;
  }

  private async buildEventCountSample(
    baselineStart: Date,
    currentStart: Date,
    currentEnd: Date,
  ): Promise<FeedSample | null> {
    try {
      // Baseline: hourly event counts over the past BASELINE_DAYS days
      const baselineEvents = await this.userEventRepo
        .createQueryBuilder('e')
        .select("DATE_TRUNC('hour', e.occurred_at)", 'hour')
        .addSelect('COUNT(*)', 'cnt')
        .where('e.occurred_at >= :start', { start: baselineStart })
        .andWhere('e.occurred_at < :end', { end: currentStart })
        .groupBy("DATE_TRUNC('hour', e.occurred_at)")
        .getRawMany<{ hour: string; cnt: string }>();

      // Current: event count in the last hour
      const currentEvents = await this.userEventRepo
        .createQueryBuilder('e')
        .select("DATE_TRUNC('hour', e.occurred_at)", 'hour')
        .addSelect('COUNT(*)', 'cnt')
        .where('e.occurred_at >= :start', { start: currentStart })
        .andWhere('e.occurred_at < :end', { end: currentEnd })
        .groupBy("DATE_TRUNC('hour', e.occurred_at)")
        .getRawMany<{ hour: string; cnt: string }>();

      const baselineValues = baselineEvents.map((r) => Number(r.cnt));
      const currentValues = currentEvents.map((r) => Number(r.cnt));

      if (baselineValues.length < 2 || currentValues.length === 0) return null;

      return { feedKey: 'event_count_per_hour', baselineValues, currentValues };
    } catch (error) {
      this.logger.error('Failed to build event count sample', (error as Error).stack);
      return null;
    }
  }

  private async buildDauSample(
    baselineStart: Date,
    currentStart: Date,
  ): Promise<FeedSample | null> {
    try {
      const baselineSnapshots = await this.metricSnapshotRepo.find({
        where: {
          periodStart: MoreThanOrEqual(baselineStart),
          periodEnd: LessThan(currentStart),
        },
        select: ['dailyActiveUsers'],
        order: { periodStart: 'ASC' },
      });

      const currentSnapshots = await this.metricSnapshotRepo.find({
        where: { periodStart: MoreThanOrEqual(currentStart) },
        select: ['dailyActiveUsers'],
        order: { periodStart: 'ASC' },
      });

      const baselineValues = baselineSnapshots.map((s) => s.dailyActiveUsers);
      const currentValues = currentSnapshots.map((s) => s.dailyActiveUsers);

      if (baselineValues.length < 2 || currentValues.length === 0) return null;

      return { feedKey: 'daily_active_users', baselineValues, currentValues };
    } catch (error) {
      this.logger.error('Failed to build DAU sample', (error as Error).stack);
      return null;
    }
  }

  private async buildConversionSample(
    baselineStart: Date,
    currentStart: Date,
  ): Promise<FeedSample | null> {
    try {
      const baselineSnapshots = await this.metricSnapshotRepo.find({
        where: {
          periodStart: MoreThanOrEqual(baselineStart),
          periodEnd: LessThan(currentStart),
        },
        select: ['swipeToTradeConversion'],
        order: { periodStart: 'ASC' },
      });

      const currentSnapshots = await this.metricSnapshotRepo.find({
        where: { periodStart: MoreThanOrEqual(currentStart) },
        select: ['swipeToTradeConversion'],
        order: { periodStart: 'ASC' },
      });

      const baselineValues = baselineSnapshots.map((s) => Number(s.swipeToTradeConversion));
      const currentValues = currentSnapshots.map((s) => Number(s.swipeToTradeConversion));

      if (baselineValues.length < 2 || currentValues.length === 0) return null;

      return { feedKey: 'swipe_to_trade_conversion', baselineValues, currentValues };
    } catch (error) {
      this.logger.error('Failed to build conversion sample', (error as Error).stack);
      return null;
    }
  }
}
