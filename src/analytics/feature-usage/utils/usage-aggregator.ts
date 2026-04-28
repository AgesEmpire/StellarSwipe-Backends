import { FeatureUsageEvent, UserSegment, UsageEventType } from '../entities/feature-usage.entity';
import { AdoptionStage } from '../entities/feature-adoption.entity';
import { FeatureRankingDto } from '../dto/feature-metrics.dto';
import { SegmentBreakdownDto } from '../dto/usage-report.dto';

export interface AggregatedFeatureStats {
  featureKey: string;
  featureCategory: string | null;
  totalEvents: number;
  uniqueUsers: Set<string>;
  errorCount: number;
  totalDurationMs: number;
  durationSamples: number;
  bySegment: Record<UserSegment, { events: number; users: Set<string> }>;
  byEventType: Record<UsageEventType, number>;
  firstSeen: Date;
  lastSeen: Date;
}

export class UsageAggregator {
  /**
   * Aggregate raw events into per-feature stats maps.
   */
  static aggregateEvents(
    events: FeatureUsageEvent[],
  ): Map<string, AggregatedFeatureStats> {
    const map = new Map<string, AggregatedFeatureStats>();

    for (const event of events) {
      const key = event.featureKey;
      let stats = map.get(key);

      if (!stats) {
        stats = this.initStats(event.featureKey, event.featureCategory);
        map.set(key, stats);
      }

      stats.totalEvents += 1;
      stats.uniqueUsers.add(event.userId);

      if (event.eventType === UsageEventType.ERROR) {
        stats.errorCount += 1;
      }

      if (event.durationMs !== null && event.durationMs !== undefined) {
        stats.totalDurationMs += event.durationMs;
        stats.durationSamples += 1;
      }

      const seg = event.userSegment ?? UserSegment.FREE;
      if (!stats.bySegment[seg]) {
        stats.bySegment[seg] = { events: 0, users: new Set() };
      }
      stats.bySegment[seg].events += 1;
      stats.bySegment[seg].users.add(event.userId);

      stats.byEventType[event.eventType] =
        (stats.byEventType[event.eventType] ?? 0) + 1;

      if (event.occurredAt < stats.firstSeen) stats.firstSeen = event.occurredAt;
      if (event.occurredAt > stats.lastSeen) stats.lastSeen = event.occurredAt;
    }

    return map;
  }

  /**
   * Determine a user's adoption stage for a feature based on their event count
   * and whether they've had recent activity.
   */
  static classifyAdoptionStage(
    eventCount: number,
    lastUsedAt: Date,
    referenceDate: Date = new Date(),
  ): AdoptionStage {
    const daysSinceLastUse =
      (referenceDate.getTime() - lastUsedAt.getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceLastUse > 30 && eventCount > 0) {
      return AdoptionStage.CHURNED;
    }
    if (eventCount === 0) return AdoptionStage.AWARENESS;
    if (eventCount === 1) return AdoptionStage.ACTIVATION;
    if (eventCount >= 10) return AdoptionStage.CHAMPION;
    if (eventCount >= 3) return AdoptionStage.HABIT;
    return AdoptionStage.ACTIVATION;
  }

  /**
   * Compute stage breakdown counts from a map of userId → (eventCount, lastUsed).
   */
  static computeStageBreakdown(
    userActivity: Map<string, { count: number; lastUsed: Date }>,
    referenceDate: Date = new Date(),
  ): Record<AdoptionStage, number> {
    const breakdown: Record<AdoptionStage, number> = {
      [AdoptionStage.AWARENESS]: 0,
      [AdoptionStage.ACTIVATION]: 0,
      [AdoptionStage.HABIT]: 0,
      [AdoptionStage.CHAMPION]: 0,
      [AdoptionStage.CHURNED]: 0,
    };

    for (const { count, lastUsed } of userActivity.values()) {
      const stage = this.classifyAdoptionStage(count, lastUsed, referenceDate);
      breakdown[stage] += 1;
    }

    return breakdown;
  }

  /**
   * Build ranked feature list from aggregated stats, sorted by total events.
   */
  static rankFeatures(
    statsMap: Map<string, AggregatedFeatureStats>,
    totalPlatformUsers: number,
    prevPeriodEvents: Map<string, number> = new Map(),
  ): FeatureRankingDto[] {
    return Array.from(statsMap.entries())
      .map(([featureKey, stats], index) => {
        const uniqueUsers = stats.uniqueUsers.size;
        const adoptionRate =
          totalPlatformUsers > 0 ? uniqueUsers / totalPlatformUsers : 0;
        const prevEvents = prevPeriodEvents.get(featureKey) ?? 0;
        const trendPercent =
          prevEvents > 0
            ? ((stats.totalEvents - prevEvents) / prevEvents) * 100
            : 0;
        const trend =
          trendPercent > 5
            ? 'growing'
            : trendPercent < -5
            ? 'declining'
            : 'stable';

        return {
          rank: 0, // assigned after sort
          featureKey,
          featureCategory: stats.featureCategory,
          totalEvents: stats.totalEvents,
          uniqueUsers,
          adoptionRate: Math.round(adoptionRate * 10000) / 10000,
          trend,
        } as FeatureRankingDto;
      })
      .sort((a, b) => b.totalEvents - a.totalEvents)
      .map((item, i) => ({ ...item, rank: i + 1 }));
  }

  /**
   * Build segment breakdown from aggregated stats across all features.
   */
  static buildSegmentBreakdown(
    statsMap: Map<string, AggregatedFeatureStats>,
    totalPlatformUsers: number,
  ): SegmentBreakdownDto[] {
    const segmentData = new Map
      UserSegment,
      { events: number; users: Set<string>; featureEvents: Map<string, number> }
    >();

    for (const [featureKey, stats] of statsMap.entries()) {
      for (const [seg, data] of Object.entries(stats.bySegment) as [
        UserSegment,
        { events: number; users: Set<string> },
      ][]) {
        if (!segmentData.has(seg)) {
          segmentData.set(seg, { events: 0, users: new Set(), featureEvents: new Map() });
        }
        const sd = segmentData.get(seg)!;
        sd.events += data.events;
        for (const u of data.users) sd.users.add(u);
        sd.featureEvents.set(featureKey, (sd.featureEvents.get(featureKey) ?? 0) + data.events);
      }
    }

    return Array.from(segmentData.entries()).map(([segment, data]) => ({
      segment,
      totalEvents: data.events,
      uniqueUsers: data.users.size,
      adoptionRate:
        totalPlatformUsers > 0
          ? Math.round((data.users.size / totalPlatformUsers) * 10000) / 10000
          : 0,
      topFeatures: Array.from(data.featureEvents.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k),
    }));
  }

  // -------------------------
  // Private helpers
  // -------------------------

  private static initStats(
    featureKey: string,
    featureCategory: string | null,
  ): AggregatedFeatureStats {
    const allSegments = Object.values(UserSegment);
    const bySegment = {} as Record<UserSegment, { events: number; users: Set<string> }>;
    for (const seg of allSegments) {
      bySegment[seg] = { events: 0, users: new Set() };
    }

    const allEventTypes = Object.values(UsageEventType);
    const byEventType = {} as Record<UsageEventType, number>;
    for (const et of allEventTypes) {
      byEventType[et] = 0;
    }

    return {
      featureKey,
      featureCategory,
      totalEvents: 0,
      uniqueUsers: new Set(),
      errorCount: 0,
      totalDurationMs: 0,
      durationSamples: 0,
      bySegment,
      byEventType,
      firstSeen: new Date(),
      lastSeen: new Date(0),
    };
  }
}