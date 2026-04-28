import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { FeatureUsageEvent, UserSegment, UsageEventType } from './entities/feature-usage.entity';
import { FeatureAdoption } from './entities/feature-adoption.entity';
import {
  TrackFeatureUsageDto,
  BulkTrackFeatureUsageDto,
  FeatureMetricsSummaryDto,
  GetFeatureMetricsDto,
  GetFeatureRankingDto,
  FeatureRankingDto,
} from './dto/feature-metrics.dto';
import {
  UsageReportQueryDto,
  UsageReportDto,
  GetUserFeatureUsageDto,
  UserFeatureUsageDto,
} from './dto/usage-report.dto';
import {
  AdoptionCurveQueryDto,
  AdoptionCurveDto,
  GetAdoptionCohortDto,
  AdoptionCohortDto,
} from './dto/adoption-curve.dto';
import { UsageAggregator } from './utils/usage-aggregator';
import { AdoptionCalculator } from './utils/adoption-calculator';

@Injectable()
export class FeatureTrackerService {
  private readonly logger = new Logger(FeatureTrackerService.name);

  constructor(
    @InjectRepository(FeatureUsageEvent)
    private readonly usageRepo: Repository<FeatureUsageEvent>,
    @InjectRepository(FeatureAdoption)
    private readonly adoptionRepo: Repository<FeatureAdoption>,
  ) {}

  // -------------------------
  // Event Tracking
  // -------------------------

  async trackEvent(dto: TrackFeatureUsageDto): Promise<void> {
    const event = this.usageRepo.create({
      featureKey: dto.featureKey,
      userId: dto.userId,
      userSegment: dto.userSegment ?? UserSegment.FREE,
      eventType: dto.eventType ?? UsageEventType.INTERACT,
      featureCategory: dto.featureCategory ?? null,
      sessionId: dto.sessionId ?? null,
      durationMs: dto.durationMs ?? null,
      metadata: dto.metadata ?? null,
      occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
    });

    await this.usageRepo.save(event);
  }

  async trackBulk(dto: BulkTrackFeatureUsageDto): Promise<{ tracked: number }> {
    const events = dto.events.map((e) =>
      this.usageRepo.create({
        featureKey: e.featureKey,
        userId: e.userId,
        userSegment: e.userSegment ?? UserSegment.FREE,
        eventType: e.eventType ?? UsageEventType.INTERACT,
        featureCategory: e.featureCategory ?? null,
        sessionId: e.sessionId ?? null,
        durationMs: e.durationMs ?? null,
        metadata: e.metadata ?? null,
        occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
      }),
    );

    await this.usageRepo.save(events);
    return { tracked: events.length };
  }

  // -------------------------
  // Metrics & Reports
  // -------------------------

  async getFeatureMetrics(dto: GetFeatureMetricsDto): Promise<FeatureMetricsSummaryDto> {
    const { from, to } = this.defaultDateRange(dto.from, dto.to);

    const where: any = {
      featureKey: dto.featureKey,
      occurredAt: Between(from, to),
    };
    if (dto.segment) where.userSegment = dto.segment;

    const events = await this.usageRepo.find({ where });
    const statsMap = UsageAggregator.aggregateEvents(events);
    const stats = statsMap.get(dto.featureKey);

    if (!stats) {
      return {
        featureKey: dto.featureKey,
        featureCategory: null,
        totalEvents: 0,
        uniqueUsers: 0,
        adoptionRate: 0,
        retentionRate: 0,
        errorRate: 0,
        avgDurationMs: null,
        topSegment: null,
        trend: 'stable',
        trendPercent: 0,
      };
    }

    const totalPlatformUsers = await this.countPlatformUsers(from, to);
    const adoptionRate =
      totalPlatformUsers > 0 ? stats.uniqueUsers.size / totalPlatformUsers : 0;
    const errorRate =
      stats.totalEvents > 0 ? stats.errorCount / stats.totalEvents : 0;
    const avgDurationMs =
      stats.durationSamples > 0
        ? stats.totalDurationMs / stats.durationSamples
        : null;

    const topSegment = this.findTopSegment(stats.bySegment);
    const { trend, trendPercent } = await this.computeTrend(dto.featureKey, from, to);

    // Fetch retention from adoption table
    const adoptionRecord = await this.adoptionRepo.findOne({
      where: { featureKey: dto.featureKey },
      order: { periodDate: 'DESC' },
    });

    return {
      featureKey: dto.featureKey,
      featureCategory: stats.featureCategory,
      totalEvents: stats.totalEvents,
      uniqueUsers: stats.uniqueUsers.size,
      adoptionRate: Math.round(adoptionRate * 10000) / 10000,
      retentionRate: adoptionRecord ? Number(adoptionRecord.retentionRate) : 0,
      errorRate: Math.round(errorRate * 10000) / 10000,
      avgDurationMs: avgDurationMs !== null ? Math.round(avgDurationMs) : null,
      topSegment,
      trend,
      trendPercent: Math.round(trendPercent * 100) / 100,
    };
  }

  async getFeatureRanking(dto: GetFeatureRankingDto): Promise<FeatureRankingDto[]> {
    const { from, to } = this.defaultDateRange(dto.from, dto.to);
    const limit = dto.limit ?? 20;

    const where: any = { occurredAt: Between(from, to) };
    if (dto.segment) where.userSegment = dto.segment;
    if (dto.featureCategory) where.featureCategory = dto.featureCategory;

    const events = await this.usageRepo.find({ where });
    const statsMap = UsageAggregator.aggregateEvents(events);

    // Previous period for trend
    const periodMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - periodMs);
    const prevEvents = await this.usageRepo.find({
      where: { occurredAt: Between(prevFrom, from) },
    });
    const prevStatsMap = UsageAggregator.aggregateEvents(prevEvents);
    const prevEventCounts = new Map(
      Array.from(prevStatsMap.entries()).map(([k, v]) => [k, v.totalEvents]),
    );

    const totalPlatformUsers = await this.countPlatformUsers(from, to);
    const ranked = UsageAggregator.rankFeatures(statsMap, totalPlatformUsers, prevEventCounts);

    return ranked.slice(0, limit);
  }

  async getUsageReport(dto: UsageReportQueryDto): Promise<UsageReportDto> {
    const { from, to } = this.defaultDateRange(dto.from, dto.to);

    const where: any = { occurredAt: Between(from, to) };
    if (dto.segment) where.userSegment = dto.segment;
    if (dto.featureCategory) where.featureCategory = dto.featureCategory;

    const events = await this.usageRepo.find({ where });
    const statsMap = UsageAggregator.aggregateEvents(events);
    const totalPlatformUsers = await this.countPlatformUsers(from, to);

    const periodMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - periodMs);
    const prevEvents = await this.usageRepo.find({
      where: { occurredAt: Between(prevFrom, from) },
    });
    const prevStatsMap = UsageAggregator.aggregateEvents(prevEvents);
    const prevEventCounts = new Map(
      Array.from(prevStatsMap.entries()).map(([k, v]) => [k, v.totalEvents]),
    );

    const ranked = UsageAggregator.rankFeatures(statsMap, totalPlatformUsers, prevEventCounts);
    const segmentBreakdown = UsageAggregator.buildSegmentBreakdown(statsMap, totalPlatformUsers);

    const allUniqueUsers = new Set(events.map((e) => e.userId));
    const featureMetrics = await Promise.all(
      Array.from(statsMap.keys()).map((key) =>
        this.getFeatureMetrics({ featureKey: key, from: from.toISOString(), to: to.toISOString() }),
      ),
    );

    return {
      periodStart: from,
      periodEnd: to,
      totalEvents: events.length,
      totalUniqueUsers: allUniqueUsers.size,
      totalFeaturesTracked: statsMap.size,
      mostUsedFeatures: ranked.slice(0, 10),
      leastUsedFeatures: ranked.slice(-10).reverse(),
      segmentBreakdown,
      featureMetrics,
      generatedAt: new Date(),
    };
  }

  async getUserFeatureUsage(dto: GetUserFeatureUsageDto): Promise<UserFeatureUsageDto> {
    const { from, to } = this.defaultDateRange(dto.from, dto.to);

    const events = await this.usageRepo.find({
      where: {
        userId: dto.userId,
        occurredAt: Between(from, to),
      },
      order: { occurredAt: 'DESC' },
    });

    if (events.length === 0) {
      return {
        userId: dto.userId,
        userSegment: UserSegment.FREE,
        featuresUsed: 0,
        totalEvents: 0,
        topFeatures: [],
        adoptionStages: {},
        firstSeenAt: null,
        lastSeenAt: null,
      };
    }

    const byFeature = new Map
      string,
      { count: number; lastUsedAt: Date }
    >();

    for (const event of events) {
      const existing = byFeature.get(event.featureKey);
      if (!existing) {
        byFeature.set(event.featureKey, { count: 1, lastUsedAt: event.occurredAt });
      } else {
        existing.count += 1;
        if (event.occurredAt > existing.lastUsedAt) {
          existing.lastUsedAt = event.occurredAt;
        }
      }
    }

    const topFeatures = Array.from(byFeature.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([featureKey, { count, lastUsedAt }]) => ({
        featureKey,
        eventCount: count,
        lastUsedAt,
      }));

    const adoptionStages: Record<string, string> = {};
    for (const [featureKey, { count, lastUsedAt }] of byFeature.entries()) {
      const stage = UsageAggregator.classifyAdoptionStage(count, lastUsedAt);
      adoptionStages[featureKey] = stage;
    }

    const userSegment = events[0]?.userSegment ?? UserSegment.FREE;
    const dates = events.map((e) => e.occurredAt);

    return {
      userId: dto.userId,
      userSegment,
      featuresUsed: byFeature.size,
      totalEvents: events.length,
      topFeatures,
      adoptionStages,
      firstSeenAt: new Date(Math.min(...dates.map((d) => d.getTime()))),
      lastSeenAt: new Date(Math.max(...dates.map((d) => d.getTime()))),
    };
  }

  // -------------------------
  // Adoption Curve
  // -------------------------

  async getAdoptionCurve(dto: AdoptionCurveQueryDto): Promise<AdoptionCurveDto> {
    const where: any = { featureKey: dto.featureKey };
    if (dto.segment) where.userSegment = dto.segment;
    if (dto.from) where.periodDate = Between(dto.from.split('T')[0], (dto.to ?? new Date().toISOString()).split('T')[0]);

    const records = await this.adoptionRepo.find({
      where,
      order: { periodDate: 'ASC' },
    });

    return AdoptionCalculator.buildAdoptionCurve(
      dto.featureKey,
      records,
      dto.segment ?? null,
    );
  }

  /**
   * Called by the scheduled job to compute and upsert daily adoption aggregates.
   */
  async aggregateDailyAdoption(date: Date): Promise<{ upserted: number }> {
    const periodDate = date.toISOString().split('T')[0];
    const dayStart = new Date(`${periodDate}T00:00:00.000Z`);
    const dayEnd = new Date(`${periodDate}T23:59:59.999Z`);

    const events = await this.usageRepo.find({
      where: { occurredAt: Between(dayStart, dayEnd) },
    });

    if (events.length === 0) return { upserted: 0 };

    const statsMap = UsageAggregator.aggregateEvents(events);
    const totalPlatformUsers = await this.countPlatformUsers(dayStart, dayEnd);

    // Get previous day's adopters per feature for retention calculation
    const prevDayStart = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
    const prevDayEvents = await this.usageRepo.find({
      where: { occurredAt: Between(prevDayStart, dayStart) },
    });
    const prevDayUsers = new Map<string, Set<string>>();
    for (const e of prevDayEvents) {
      if (!prevDayUsers.has(e.featureKey)) prevDayUsers.set(e.featureKey, new Set());
      prevDayUsers.get(e.featureKey)!.add(e.userId);
    }

    let upserted = 0;

    for (const [featureKey, stats] of statsMap.entries()) {
      const uniqueUsersToday = stats.uniqueUsers;
      const prevUsers = prevDayUsers.get(featureKey) ?? new Set<string>();

      const newUsers = [...uniqueUsersToday].filter((u) => !prevUsers.has(u)).length;
      const returningUsers = [...uniqueUsersToday].filter((u) => prevUsers.has(u)).length;
      const retentionRate =
        prevUsers.size > 0 ? returningUsers / prevUsers.size : 0;
      const adoptionRate =
        totalPlatformUsers > 0 ? uniqueUsersToday.size / totalPlatformUsers : 0;
      const errorRate =
        stats.totalEvents > 0 ? stats.errorCount / stats.totalEvents : 0;
      const avgDurationMs =
        stats.durationSamples > 0
          ? stats.totalDurationMs / stats.durationSamples
          : null;

      // Build user activity map for stage breakdown
      const userActivity = new Map<string, { count: number; lastUsed: Date }>();
      for (const event of events.filter((e) => e.featureKey === featureKey)) {
        const existing = userActivity.get(event.userId);
        if (!existing) {
          userActivity.set(event.userId, { count: 1, lastUsed: event.occurredAt });
        } else {
          existing.count += 1;
          if (event.occurredAt > existing.lastUsed) existing.lastUsed = event.occurredAt;
        }
      }
      const stageBreakdown = UsageAggregator.computeStageBreakdown(userActivity, dayEnd);

      await this.adoptionRepo
        .createQueryBuilder()
        .insert()
        .into(FeatureAdoption)
        .values({
          featureKey,
          featureCategory: stats.featureCategory,
          periodDate,
          userSegment: null,
          totalEvents: stats.totalEvents,
          uniqueUsers: uniqueUsersToday.size,
          newUsers,
          returningUsers,
          adoptionRate,
          retentionRate,
          avgDurationMs,
          errorRate,
          stageBreakdown,
          aggregatedAt: new Date(),
        })
        .orUpdate(
          [
            'total_events', 'unique_users', 'new_users', 'returning_users',
            'adoption_rate', 'retention_rate', 'avg_duration_ms', 'error_rate',
            'stage_breakdown', 'aggregated_at',
          ],
          ['feature_key', 'period_date', 'user_segment'],
        )
        .execute();

      upserted++;
    }

    this.logger.log(`Daily adoption aggregated for ${periodDate}: ${upserted} features.`);
    return { upserted };
  }

  // -------------------------
  // Private helpers
  // -------------------------

  private defaultDateRange(
    from?: string,
    to?: string,
  ): { from: Date; to: Date } {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from
      ? new Date(from)
      : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: fromDate, to: toDate };
  }

  private async countPlatformUsers(from: Date, to: Date): Promise<number> {
    const result = await this.usageRepo
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.user_id)', 'count')
      .where('e.occurred_at BETWEEN :from AND :to', { from, to })
      .getRawOne();
    return parseInt(result?.count ?? '0', 10);
  }

  private findTopSegment(
    bySegment: Record<UserSegment, { events: number; users: Set<string> }>,
  ): UserSegment | null {
    let top: UserSegment | null = null;
    let max = 0;
    for (const [seg, data] of Object.entries(bySegment) as [UserSegment, { events: number; users: Set<string> }][]) {
      if (data.events > max) {
        max = data.events;
        top = seg;
      }
    }
    return top;
  }

  private async computeTrend(
    featureKey: string,
    from: Date,
    to: Date,
  ): Promise<{ trend: 'growing' | 'stable' | 'declining'; trendPercent: number }> {
    const periodMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - periodMs);

    const [currentCount, prevCount] = await Promise.all([
      this.usageRepo.count({ where: { featureKey, occurredAt: Between(from, to) } }),
      this.usageRepo.count({ where: { featureKey, occurredAt: Between(prevFrom, from) } }),
    ]);

    const trendPercent =
      prevCount > 0 ? ((currentCount - prevCount) / prevCount) * 100 : 0;
    const trend =
      trendPercent > 5 ? 'growing' : trendPercent < -5 ? 'declining' : 'stable';

    return { trend, trendPercent };
  }
}