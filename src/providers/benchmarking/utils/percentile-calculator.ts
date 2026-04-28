import {
  PerformanceTier,
  PlatformStats,
} from '../interfaces/benchmark-metric.interface';

export class PercentileCalculator {
  /**
   * Compute the percentile rank of a value within a sorted dataset.
   * Returns a value in [0, 100].
   */
  static computePercentileRank(value: number, sortedDataset: number[]): number {
    if (sortedDataset.length === 0) return 50;

    const below = sortedDataset.filter((v) => v < value).length;
    const equal = sortedDataset.filter((v) => v === value).length;

    // Use the "greater than or equal to half of ties" formula
    const rank = ((below + equal * 0.5) / sortedDataset.length) * 100;
    return Math.round(rank * 100) / 100;
  }

  /**
   * Get the value at a given percentile from a sorted dataset.
   */
  static getPercentileValue(
    sortedDataset: number[],
    percentile: number,
  ): number {
    if (sortedDataset.length === 0) return 0;
    const index = (percentile / 100) * (sortedDataset.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sortedDataset[lower];
    const fraction = index - lower;
    return (
      sortedDataset[lower] * (1 - fraction) + sortedDataset[upper] * fraction
    );
  }

  /**
   * Compute full distribution statistics for a metric across all providers.
   */
  static computePlatformStats(
    metricName: string,
    values: number[],
  ): PlatformStats {
    if (values.length === 0) {
      return {
        metricName,
        mean: 0,
        median: 0,
        stdDev: 0,
        p25: 0,
        p75: 0,
        p90: 0,
        sampleSize: 0,
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance =
      values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return {
      metricName,
      mean: Math.round(mean * 10000) / 10000,
      median: this.getPercentileValue(sorted, 50),
      stdDev: Math.round(stdDev * 10000) / 10000,
      p25: this.getPercentileValue(sorted, 25),
      p75: this.getPercentileValue(sorted, 75),
      p90: this.getPercentileValue(sorted, 90),
      sampleSize: values.length,
    };
  }

  /**
   * Map a percentile rank to a performance tier.
   */
  static toPerformanceTier(percentileRank: number): PerformanceTier {
    if (percentileRank >= 75) return PerformanceTier.TOP;
    if (percentileRank >= 50) return PerformanceTier.ABOVE_AVERAGE;
    if (percentileRank >= 25) return PerformanceTier.BELOW_AVERAGE;
    return PerformanceTier.BOTTOM;
  }

  /**
   * Compute a weighted overall score from a set of (value, weight) pairs
   * where all weights sum to 1.
   */
  static computeWeightedScore(
    entries: Array<{ percentileRank: number; weight: number }>,
  ): number {
    if (entries.length === 0) return 0;
    const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
    if (totalWeight === 0) return 0;
    const score = entries.reduce(
      (s, e) => s + (e.percentileRank * e.weight) / totalWeight,
      0,
    );
    return Math.round(score * 100) / 100;
  }

  /**
   * Compute a z-score: how many standard deviations the value is from the mean.
   */
  static zScore(value: number, mean: number, stdDev: number): number {
    if (stdDev === 0) return 0;
    return (value - mean) / stdDev;
  }
}
