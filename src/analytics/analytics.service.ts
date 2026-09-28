import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { QueryFailedError, Repository, DataSource } from 'typeorm';
import { MetricSnapshot, MetricPeriod } from './entities/metric-snapshot.entity';
import { UserEvent, UserEventType } from './entities/user-event.entity';

export interface TrackEventInput {
  eventType: UserEventType;
  occurredAt: Date;
  userId?: string;
  sessionId?: string;
  eventId?: string;
  metadata?: Record<string, unknown>;
}

export interface MetricAggregation {
  activeUsers: number;
  totalEvents: number;
  totalSwipesRight: number;
  totalSwipesLeft: number;
  totalTrades: number;
  totalSignalViews: number;
  totalRevenue: number;
  avgSessionSeconds: number;
  swipeToTradeConversion: number;
  revenuePerUser: number;
  avgEventsPerUser: number;
  mauRetention: number;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(UserEvent)
    private readonly userEventRepository: Repository<UserEvent>,
    @InjectRepository(MetricSnapshot)
    private readonly metricSnapshotRepository: Repository<MetricSnapshot>,
    @InjectDataSource('replica')
    private readonly replicaDataSource: DataSource,
    @InjectDataSource()
    private readonly primaryDataSource: DataSource,
  ) { }

  private getReadDataSource(): DataSource {
    return this.replicaDataSource || this.primaryDataSource;
  }

  private async executeReadQuery<T>(
    queryFn: (dataSource: DataSource) => Promise<T>,
  ): Promise<T> {
    try {
      return await queryFn(this.getReadDataSource());
    } catch (error) {
      this.logger.warn('Replica query failed, falling back to primary', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return await queryFn(this.primaryDataSource);
    }
  }

  async trackEvent(input: TrackEventInput): Promise<{ status: 'tracked' | 'duplicate' }> {
    const event = this.userEventRepository.create({
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      userId: input.userId,
      sessionId: input.sessionId,
      eventId: input.eventId,
      metadata: input.metadata,
    });

    try {
      await this.userEventRepository.insert(event);
      return { status: 'tracked' };
    } catch (error) {
      if (error instanceof QueryFailedError && (error as { code?: string }).code === '23505') {
        return { status: 'duplicate' };
      }
      throw error;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async aggregateDailyMetrics(): Promise<void> {
    const timezone = 'UTC';
    const reference = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { periodStart, periodEnd } = await this.resolvePeriodBounds(reference, MetricPeriod.DAILY, timezone);
    await this.upsertSnapshot(MetricPeriod.DAILY, periodStart, periodEnd, timezone);
    this.logger.log(`Aggregated daily metrics for ${periodStart.toISOString()}`);
  }

  async getDashboardData(query: {
    period: MetricPeriod;
    startDate: Date;
    endDate: Date;
    timezone: string;
  }): Promise<{
    period: MetricPeriod;
    timezone: string;
    startDate: string;
    endDate: string;
    snapshots: MetricSnapshot[];
    summary: MetricAggregation;
  }> {
    const intervals = this.buildIntervals(query.startDate, query.endDate, query.period);
    const snapshots: MetricSnapshot[] = [];

    for (const interval of intervals) {
      const snapshot = await this.upsertSnapshot(query.period, interval.start, interval.end, query.timezone);
      snapshots.push(snapshot);
    }

    const summary = await this.collectMetrics(query.period, query.startDate, query.endDate, query.timezone);

    return {
      period: query.period,
      timezone: query.timezone,
      startDate: query.startDate.toISOString(),
      endDate: query.endDate.toISOString(),
      snapshots,
      summary,
    };
  }

  async exportMetrics(query: {
    period: MetricPeriod;
    startDate: Date;
    endDate: Date;
    timezone: string;
  }): Promise<string> {
    const { snapshots } = await this.getDashboardData(query);
    const headers = [
      'period',
      'period_start',
      'period_end',
      'timezone',
      'active_users',
      'avg_session_seconds',
      'swipe_to_trade_conversion',
      'mau_retention',
      'avg_events_per_user',
      'total_swipes_right',
      'total_swipes_left',
      'total_trades',
      'total_signal_views',
      'total_revenue',
      'revenue_per_user',
    ];

    const rows = snapshots.map(snapshot => {
      const activeUsers = this.resolveActiveUsers(snapshot);
      return [
        snapshot.period,
        snapshot.periodStart.toISOString(),
        snapshot.periodEnd.toISOString(),
        snapshot.timezone,
        activeUsers,
        snapshot.avgSessionSeconds,
        snapshot.swipeToTradeConversion,
        snapshot.mauRetention,
        snapshot.avgEventsPerUser,
        snapshot.totalSwipesRight,
        snapshot.totalSwipesLeft,
        snapshot.totalTrades,
        snapshot.totalSignalViews,
        snapshot.totalRevenue,
        snapshot.revenuePerUser,
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  private async upsertSnapshot(
    period: MetricPeriod,
    periodStart: Date,
    periodEnd: Date,
    timezone: string,
  ): Promise<MetricSnapshot> {
    const metrics = await this.collectMetrics(period, periodStart, periodEnd, timezone);

    const snapshot = this.metricSnapshotRepository.create({
      period,
      periodStart,
      periodEnd,
      timezone,
      dailyActiveUsers: period === MetricPeriod.DAILY ? metrics.activeUsers : 0,
      weeklyActiveUsers: period === MetricPeriod.WEEKLY ? metrics.activeUsers : 0,
      monthlyActiveUsers: period === MetricPeriod.MONTHLY ? metrics.activeUsers : 0,
      avgSessionSeconds: this.formatNumber(metrics.avgSessionSeconds, 2),
      swipeToTradeConversion: this.formatNumber(metrics.swipeToTradeConversion, 2),
      revenuePerUser: this.formatNumber(metrics.revenuePerUser, 6),
      mauRetention: this.formatNumber(metrics.mauRetention, 2),
      avgEventsPerUser: this.formatNumber(metrics.avgEventsPerUser, 2),
      totalSwipesRight: metrics.totalSwipesRight,
      totalSwipesLeft: metrics.totalSwipesLeft,
      totalTrades: metrics.totalTrades,
      totalSignalViews: metrics.totalSignalViews,
      totalRevenue: this.formatNumber(metrics.totalRevenue, 6),
    });

    await this.metricSnapshotRepository
      .createQueryBuilder()
      .insert()
      .values(snapshot)
      .orUpdate(
        [
          'dau',
          'wau',
          'mau',
          'avg_session_seconds',
          'swipe_to_trade_conversion',
          'revenue_per_user',
          'mau_retention',
          'avg_events_per_user',
          'total_swipes_right',
          'total_swipes_left',
          'total_trades',
          'total_signal_views',
          'total_revenue',
        ],
        ['period', 'period_start', 'timezone'],
      )
      .execute();

    return this.metricSnapshotRepository.findOneOrFail({
      where: { period, periodStart, timezone },
    });
  }

  private async collectMetrics(
    period: MetricPeriod,
    periodStart: Date,
    periodEnd: Date,
    timezone: string,
  ): Promise<MetricAggregation> {
    const [totals] = await this.executeReadQuery(async (dataSource) =>
      dataSource.query(
        `
          SELECT
            COUNT(*)::int AS total_events,
            COUNT(DISTINCT user_id)::int AS active_users,
            SUM(CASE WHEN event_type = $3 THEN 1 ELSE 0 END)::int AS total_swipes_right,
            SUM(CASE WHEN event_type = $4 THEN 1 ELSE 0 END)::int AS total_swipes_left,
            SUM(CASE WHEN event_type = $5 THEN 1 ELSE 0 END)::int AS total_trades,
            SUM(CASE WHEN event_type = $6 THEN 1 ELSE 0 END)::int AS total_signal_views,
            COALESCE(SUM(
              COALESCE(NULLIF(metadata->>'revenue', '')::numeric, NULLIF(metadata->>'feeAmount', '')::numeric, 0)
            ), 0) AS total_revenue
          FROM user_events
          WHERE occurred_at >= $1
            AND occurred_at < $2
        `,
        [
          periodStart,
          periodEnd,
          UserEventType.SWIPE_RIGHT,
          UserEventType.SWIPE_LEFT,
          UserEventType.TRADE_EXECUTED,
          UserEventType.SIGNAL_VIEW,
        ],
      ),
    );

    const [sessionAvg] = await this.executeReadQuery(async (dataSource) =>
      dataSource.query(
        `
          SELECT COALESCE(AVG(session_seconds), 0) AS avg_session_seconds
          FROM (
            SELECT user_id,
                   EXTRACT(EPOCH FROM (MAX(occurred_at) - MIN(occurred_at))) AS session_seconds
            FROM user_events
            WHERE occurred_at >= $1
              AND occurred_at < $2
              AND user_id IS NOT NULL
            GROUP BY user_id
          ) per_user
        `,
        [periodStart, periodEnd],
      ),
    );

    const activeUsers = Number(totals.active_users ?? 0);
    const totalEvents = Number(totals.total_events ?? 0);
    const totalSwipesRight = Number(totals.total_swipes_right ?? 0);
    const totalSwipesLeft = Number(totals.total_swipes_left ?? 0);
    const totalTrades = Number(totals.total_trades ?? 0);
    const totalSignalViews = Number(totals.total_signal_views ?? 0);
    const totalRevenue = Number(totals.total_revenue ?? 0);
    const avgSessionSeconds = Number(sessionAvg.avg_session_seconds ?? 0);

    const swipeToTradeConversion = totalSwipesRight > 0
      ? (totalTrades / totalSwipesRight) * 100
      : 0;
    const revenuePerUser = activeUsers > 0 ? totalRevenue / activeUsers : 0;
    const avgEventsPerUser = activeUsers > 0 ? totalEvents / activeUsers : 0;

    const mauRetention = period === MetricPeriod.MONTHLY
      ? await this.calculateMauRetention(periodStart, periodEnd, timezone)
      : 0;

    return {
      activeUsers,
      totalEvents,
      totalSwipesRight,
      totalSwipesLeft,
      totalTrades,
      totalSignalViews,
      totalRevenue,
      avgSessionSeconds,
      swipeToTradeConversion,
      revenuePerUser,
      avgEventsPerUser,
      mauRetention,
    };
  }

  private async calculateMauRetention(
    periodStart: Date,
    periodEnd: Date,
    _timezone: string,
  ): Promise<number> {
    const previousStart = new Date(periodStart);
    previousStart.setMonth(previousStart.getMonth() - 1);
    const previousEnd = new Date(periodEnd);
    previousEnd.setMonth(previousEnd.getMonth() - 1);

    const [result] = await this.executeReadQuery(async (dataSource) =>
      dataSource.query(
        `
          SELECT COUNT(*)::int AS returning_users
          FROM (
            SELECT DISTINCT current_events.user_id
            FROM (
              SELECT DISTINCT user_id
              FROM user_events
              WHERE occurred_at >= $1
                AND occurred_at < $2
                AND user_id IS NOT NULL
            ) current_events
            INNER JOIN (
              SELECT DISTINCT user_id
              FROM user_events
              WHERE occurred_at >= $3
                AND occurred_at < $4
                AND user_id IS NOT NULL
            ) previous_events
            ON current_events.user_id = previous_events.user_id
          ) retained
        `,
        [periodStart, periodEnd, previousStart, previousEnd],
      ),
    );

    const returningUsers = Number(result.returning_users ?? 0);
    const activeUsers = await this.countDistinctUsers(periodStart, periodEnd);

    return activeUsers > 0 ? (returningUsers / activeUsers) * 100 : 0;
  }

  private async countDistinctUsers(periodStart: Date, periodEnd: Date): Promise<number> {
    const [result] = await this.executeReadQuery(async (dataSource) =>
      dataSource.query(
        `
          SELECT COUNT(DISTINCT user_id)::int AS active_users
          FROM user_events
          WHERE occurred_at >= $1
            AND occurred_at < $2
            AND user_id IS NOT NULL
        `,
        [periodStart, periodEnd],
      ),
    );

    return Number(result.active_users ?? 0);
  }

  private buildIntervals(startDate: Date, endDate: Date, period: MetricPeriod): Array<{ start: Date; end: Date }> {
    const intervals: Array<{ start: Date; end: Date }> = [];
    let cursor = new Date(startDate);

    while (cursor < endDate) {
      const next = this.addPeriod(cursor, period);
      if (next <= cursor) {
        break;
      }
      intervals.push({ start: new Date(cursor), end: new Date(next) });
      cursor = next;
    }

    return intervals;
  }

  private addPeriod(date: Date, period: MetricPeriod): Date {
    const next = new Date(date);
    if (period === MetricPeriod.DAILY) {
      next.setDate(next.getDate() + 1);
    } else if (period === MetricPeriod.WEEKLY) {
      next.setDate(next.getDate() + 7);
    } else {
      next.setMonth(next.getMonth() + 1);
    }
    return next;
  }

  private async resolvePeriodBounds(
    referenceDate: Date,
    period: MetricPeriod,
    timezone: string,
  ): Promise<{ periodStart: Date; periodEnd: Date }> {
    const truncUnit = period === MetricPeriod.DAILY ? 'day' : period === MetricPeriod.WEEKLY ? 'week' : 'month';
    const interval = period === MetricPeriod.DAILY ? '1 day' : period === MetricPeriod.WEEKLY ? '1 week' : '1 month';

    const [result] = await this.metricSnapshotRepository.query(
      `
        SELECT
          (date_trunc($1, timezone($2, $3::timestamptz)) AT TIME ZONE $2) AS period_start,
          ((date_trunc($1, timezone($2, $3::timestamptz)) + $4::interval) AT TIME ZONE $2) AS period_end
      `,
      [truncUnit, timezone, referenceDate.toISOString(), interval],
    );

    return {
      periodStart: new Date(result.period_start),
      periodEnd: new Date(result.period_end),
    };
  }

  private formatNumber(value: number, digits: number): string {
    if (!Number.isFinite(value)) {
      return '0';
    }
    return value.toFixed(digits);
  }

  private resolveActiveUsers(snapshot: MetricSnapshot): number {
    if (snapshot.period === MetricPeriod.DAILY) {
      return snapshot.dailyActiveUsers;
    }
    if (snapshot.period === MetricPeriod.WEEKLY) {
      return snapshot.weeklyActiveUsers;
    }
    return snapshot.monthlyActiveUsers;
  }
}
