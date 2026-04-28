import { DecayCurveType } from '../entities/signal-decay.entity';
import {
  TimingWindowDto,
  OptimalTimingResultDto,
} from '../dto/optimal-timing.dto';
import { DecayCurveFitter } from './decay-curve-fitter';

export interface SignalDecaySnapshot {
  signalType: string;
  decayCurveType: DecayCurveType;
  curveParameters: Record<string, number>;
  halfLifeHours: number;
  optimalEntryWindowStart: number | null;
  optimalEntryWindowEnd: number | null;
  recommendedExpiryHours: number;
  performanceByHour: Record<string, number>;
  sampleCount: number;
}

export class TimingOptimizer {
  private static readonly ACCURACY_THRESHOLD = 0.55;
  private static readonly WINDOW_MERGE_GAP_HOURS = 2;

  /**
   * Derive optimal timing windows from a set of historical decay snapshots.
   */
  static computeOptimalTiming(
    signalType: string,
    snapshots: SignalDecaySnapshot[],
    minAccuracyThreshold = this.ACCURACY_THRESHOLD,
  ): OptimalTimingResultDto {
    if (snapshots.length === 0) {
      throw new Error(
        `No decay snapshots available for signal type: ${signalType}`,
      );
    }

    const hourlyAccuracies = this.aggregateHourlyAccuracies(snapshots);
    const optimalWindows = this.detectWindows(
      hourlyAccuracies,
      minAccuracyThreshold,
      true,
    );
    const avoidanceWindows = this.detectWindows(
      hourlyAccuracies,
      minAccuracyThreshold,
      false,
    );
    const peakHour = this.findPeakHour(hourlyAccuracies);
    const avgHalfLife =
      snapshots.reduce((s, snap) => s + snap.halfLifeHours, 0) /
      snapshots.length;
    const recommendedMaxLifespan =
      this.computeRecommendedMaxLifespan(snapshots);
    const totalSamples = snapshots.reduce((s, snap) => s + snap.sampleCount, 0);
    const insights = this.generateInsights(
      optimalWindows,
      avoidanceWindows,
      peakHour,
      avgHalfLife,
      snapshots,
    );

    return {
      signalType,
      optimalWindows,
      peakPerformanceHour: peakHour,
      avoidanceWindows,
      recommendedMaxLifespanHours: recommendedMaxLifespan,
      averageHalfLifeHours: avgHalfLife,
      dataPoints: totalSamples,
      generatedAt: new Date(),
      insights,
    };
  }

  /**
   * Assess the current lifespan of a signal and recommend whether to expire it.
   */
  static assessSignalLifespan(
    signalId: string,
    signalType: string,
    signalCreatedAt: Date,
    decayCurveType: DecayCurveType,
    curveParameters: Record<string, number>,
    recommendedExpiryHours: number,
    minAccuracyThreshold = this.ACCURACY_THRESHOLD,
  ) {
    const now = new Date();
    const ageMs = now.getTime() - signalCreatedAt.getTime();
    const currentAgeHours = ageMs / (1000 * 60 * 60);
    const currentAccuracyEstimate = DecayCurveFitter.predict(
      currentAgeHours,
      decayCurveType,
      curveParameters,
    );
    const shouldExpire =
      currentAccuracyEstimate < minAccuracyThreshold ||
      currentAgeHours >= recommendedExpiryHours;

    let expiryReason: string | null = null;
    if (currentAccuracyEstimate < minAccuracyThreshold) {
      expiryReason = `Accuracy dropped below threshold (${(currentAccuracyEstimate * 100).toFixed(1)}% < ${(minAccuracyThreshold * 100).toFixed(1)}%)`;
    } else if (currentAgeHours >= recommendedExpiryHours) {
      expiryReason = `Signal exceeded recommended lifespan of ${recommendedExpiryHours.toFixed(1)} hours`;
    }

    const remainingLifespanHours = Math.max(
      0,
      recommendedExpiryHours - currentAgeHours,
    );
    const nextEvaluationHours = shouldExpire
      ? 0
      : Math.min(remainingLifespanHours / 4, 6);

    return {
      signalId,
      signalType,
      currentAgeHours: Math.round(currentAgeHours * 100) / 100,
      remainingLifespanHours: Math.round(remainingLifespanHours * 100) / 100,
      currentAccuracyEstimate:
        Math.round(currentAccuracyEstimate * 10000) / 10000,
      shouldExpire,
      expiryReason,
      nextEvaluationHours: Math.round(nextEvaluationHours * 100) / 100,
    };
  }

  // -------------------------
  // Private helpers
  // -------------------------

  private static aggregateHourlyAccuracies(
    snapshots: SignalDecaySnapshot[],
  ): Map<number, { totalAccuracy: number; count: number }> {
    const map = new Map<number, { totalAccuracy: number; count: number }>();

    for (const snap of snapshots) {
      if (!snap.performanceByHour) continue;
      for (const [hourStr, accuracy] of Object.entries(
        snap.performanceByHour,
      )) {
        const hour = Number(hourStr);
        if (!isNaN(hour) && isFinite(accuracy)) {
          const existing = map.get(hour) ?? { totalAccuracy: 0, count: 0 };
          existing.totalAccuracy += accuracy;
          existing.count += 1;
          map.set(hour, existing);
        }
      }
    }

    return map;
  }

  private static detectWindows(
    hourlyAccuracies: Map<number, { totalAccuracy: number; count: number }>,
    threshold: number,
    aboveThreshold: boolean,
  ): TimingWindowDto[] {
    const hours = Array.from(hourlyAccuracies.keys()).sort((a, b) => a - b);
    const windows: TimingWindowDto[] = [];
    let windowStart: number | null = null;
    let windowAccuracies: number[] = [];
    let windowSamples = 0;

    const flush = (endHour: number) => {
      if (windowStart !== null && windowAccuracies.length > 0) {
        const avgAccuracy =
          windowAccuracies.reduce((s, v) => s + v, 0) / windowAccuracies.length;
        const confidence = Math.min(1, windowSamples / 30);
        windows.push({
          startHour: windowStart,
          endHour,
          expectedAccuracy: Math.round(avgAccuracy * 10000) / 10000,
          confidenceScore: Math.round(confidence * 100) / 100,
          sampleCount: windowSamples,
        });
      }
      windowStart = null;
      windowAccuracies = [];
      windowSamples = 0;
    };

    for (let i = 0; i < hours.length; i++) {
      const hour = hours[i];
      const { totalAccuracy, count } = hourlyAccuracies.get(hour)!;
      const avgAccuracy = totalAccuracy / count;
      const meetsCondition = aboveThreshold
        ? avgAccuracy >= threshold
        : avgAccuracy < threshold;

      if (meetsCondition) {
        if (windowStart === null) {
          windowStart = hour;
        }
        windowAccuracies.push(avgAccuracy);
        windowSamples += count;

        const nextHour = hours[i + 1];
        const isGap =
          nextHour !== undefined &&
          nextHour - hour > this.WINDOW_MERGE_GAP_HOURS;
        if (isGap || i === hours.length - 1) {
          flush(hour);
        }
      } else if (windowStart !== null) {
        flush(hour - 1);
      }
    }

    return windows;
  }

  private static findPeakHour(
    hourlyAccuracies: Map<number, { totalAccuracy: number; count: number }>,
  ): number {
    let bestHour = 0;
    let bestAccuracy = -Infinity;

    for (const [hour, { totalAccuracy, count }] of hourlyAccuracies.entries()) {
      const avg = totalAccuracy / count;
      if (avg > bestAccuracy) {
        bestAccuracy = avg;
        bestHour = hour;
      }
    }

    return bestHour;
  }

  private static computeRecommendedMaxLifespan(
    snapshots: SignalDecaySnapshot[],
  ): number {
    const expiries = snapshots
      .map((s) => s.recommendedExpiryHours)
      .filter(isFinite);
    if (expiries.length === 0) return 24;
    expiries.sort((a, b) => a - b);
    // Use the 25th percentile to be conservative
    const p25Index = Math.floor(expiries.length * 0.25);
    return Math.round(expiries[p25Index] * 100) / 100;
  }

  private static generateInsights(
    optimalWindows: TimingWindowDto[],
    avoidanceWindows: TimingWindowDto[],
    peakHour: number,
    avgHalfLife: number,
    snapshots: SignalDecaySnapshot[],
  ): string[] {
    const insights: string[] = [];

    if (optimalWindows.length > 0) {
      const best = optimalWindows.reduce((a, b) =>
        a.expectedAccuracy > b.expectedAccuracy ? a : b,
      );
      insights.push(
        `Best entry window is hours ${best.startHour}–${best.endHour} with ~${(best.expectedAccuracy * 100).toFixed(1)}% expected accuracy.`,
      );
    }

    insights.push(
      `Peak performance observed at hour ${peakHour} after signal generation.`,
    );
    insights.push(
      `Average signal half-life is ${avgHalfLife.toFixed(1)} hours — accuracy halves within this period.`,
    );

    if (avoidanceWindows.length > 0) {
      const worst = avoidanceWindows.reduce((a, b) =>
        a.expectedAccuracy < b.expectedAccuracy ? a : b,
      );
      insights.push(
        `Avoid entries between hours ${worst.startHour}–${worst.endHour} (expected accuracy ~${(worst.expectedAccuracy * 100).toFixed(1)}%).`,
      );
    }

    const dominated = snapshots.filter(
      (s) => s.decayCurveType === snapshots[0]?.decayCurveType,
    ).length;
    if (dominated > snapshots.length * 0.6) {
      insights.push(
        `Most signals follow a ${snapshots[0]?.decayCurveType} decay pattern — use this for forward projections.`,
      );
    }

    return insights;
  }
}
