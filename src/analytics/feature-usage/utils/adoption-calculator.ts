import {
  FeatureAdoption,
  AdoptionStage,
} from '../entities/feature-adoption.entity';
import {
  AdoptionCurveDto,
  AdoptionDataPointDto,
  AdoptionCohortDto,
} from '../dto/adoption-curve.dto';
import { UserSegment } from '../entities/feature-usage.entity';

export class AdoptionCalculator {
  /**
   * Build an adoption curve DTO from a time-series of daily adoption records.
   */
  static buildAdoptionCurve(
    featureKey: string,
    records: FeatureAdoption[],
    segment: UserSegment | null = null,
  ): AdoptionCurveDto {
    const sorted = [...records].sort((a, b) =>
      a.periodDate.localeCompare(b.periodDate),
    );

    const dataPoints: AdoptionDataPointDto[] = sorted.map((r) => ({
      date: r.periodDate,
      uniqueUsers: r.uniqueUsers,
      newUsers: r.newUsers,
      returningUsers: r.returningUsers,
      adoptionRate: Number(r.adoptionRate),
      retentionRate: Number(r.retentionRate),
      stageBreakdown: r.stageBreakdown,
    }));

    const rates = sorted.map((r) => Number(r.adoptionRate));
    const peakRate = rates.length > 0 ? Math.max(...rates) : 0;
    const peakIndex = rates.indexOf(peakRate);
    const peakDate = peakIndex >= 0 ? sorted[peakIndex].periodDate : null;
    const currentRate = rates.length > 0 ? rates[rates.length - 1] : 0;

    const growthRate = this.computeGrowthRate(rates);
    const timeToActivation = this.estimateTimeToActivation(sorted);

    return {
      featureKey,
      segment,
      dataPoints,
      peakAdoptionRate: Math.round(peakRate * 10000) / 10000,
      peakDate,
      currentAdoptionRate: Math.round(currentRate * 10000) / 10000,
      growthRate: Math.round(growthRate * 100) / 100,
      timeToActivationDays: timeToActivation,
      generatedAt: new Date(),
    };
  }

  /**
   * Compute week-over-week retention for a feature cohort.
   * cohortUsers: map of userId → first-use date.
   * weeklyActivity: map of userId → set of week-start dates active.
   */
  static buildCohortRetention(
    featureKey: string,
    cohortDate: string,
    cohortUsers: Map<string, Date>,
    weeklyActivity: Map<string, Set<string>>,
    weeksToTrack = 8,
  ): AdoptionCohortDto {
    const cohortStart = new Date(cohortDate);
    const retentionByWeek: Record<number, number> = {};

    for (let week = 0; week <= weeksToTrack; week++) {
      const weekStart = new Date(cohortStart);
      weekStart.setDate(weekStart.getDate() + week * 7);
      const weekKey = weekStart.toISOString().split('T')[0];

      const retained = Array.from(cohortUsers.keys()).filter((userId) => {
        const userWeeks = weeklyActivity.get(userId);
        return userWeeks?.has(weekKey) ?? false;
      }).length;

      retentionByWeek[week] =
        cohortUsers.size > 0
          ? Math.round((retained / cohortUsers.size) * 10000) / 10000
          : 0;
    }

    return {
      cohortDate,
      cohortSize: cohortUsers.size,
      retentionByWeek,
      featureKey,
    };
  }

  /**
   * Compute the compound weekly growth rate from a series of adoption rates.
   * Returns a percentage value.
   */
  static computeGrowthRate(rates: number[]): number {
    if (rates.length < 2) return 0;

    const first = rates[0];
    const last = rates[rates.length - 1];

    if (first === 0) return last > 0 ? 100 : 0;

    const periods = rates.length - 1;
    // Compound growth: (last/first)^(1/n) - 1
    const cagr = (Math.pow(last / first, 1 / periods) - 1) * 100;
    return isFinite(cagr) ? cagr : 0;
  }

  /**
   * Estimate the median number of days from first exposure to first activation
   * (i.e. the first day new_users > 0 for a feature).
   */
  static estimateTimeToActivation(records: FeatureAdoption[]): number | null {
    const activationRecord = records.find((r) => r.newUsers > 0);
    if (!activationRecord || records.length === 0) return null;

    const firstRecord = records[0];
    const firstDate = new Date(firstRecord.periodDate);
    const activationDate = new Date(activationRecord.periodDate);

    const days = Math.round(
      (activationDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    return days >= 0 ? days : null;
  }

  /**
   * Produce a human-readable trend summary for a feature.
   */
  static summariseTrend(
    currentRate: number,
    growthRate: number,
    stageBreakdown: Record<AdoptionStage, number> | null,
  ): string {
    const trendLabel =
      growthRate > 10
        ? 'rapidly growing'
        : growthRate > 2
          ? 'growing steadily'
          : growthRate < -10
            ? 'declining sharply'
            : growthRate < -2
              ? 'declining'
              : 'stable';

    const adoptionPct = (currentRate * 100).toFixed(1);
    let summary = `Feature is ${trendLabel} at ${adoptionPct}% adoption (${growthRate >= 0 ? '+' : ''}${growthRate.toFixed(1)}% growth rate).`;

    if (stageBreakdown) {
      const champions = stageBreakdown[AdoptionStage.CHAMPION] ?? 0;
      const churned = stageBreakdown[AdoptionStage.CHURNED] ?? 0;
      if (champions > 0)
        summary += ` ${champions} champion user(s) driving retention.`;
      if (churned > 0) summary += ` ${churned} user(s) have churned.`;
    }

    return summary;
  }
}
