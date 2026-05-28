export interface DistributionSummary {
  count: number;
  mean: number;
  variance: number;
  stdDev: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
}

export interface DistributionComparison {
  metric: string;
  baseline: DistributionSummary;
  current: DistributionSummary;
  meanDelta: number;
  relativeMeanDelta: number;
  stdDevRatio: number;
  driftScore: number;
  threshold: number;
  drifted: boolean;
}

const DEFAULT_THRESHOLD = 0.25;

export function summarizeDistribution(values: number[]): DistributionSummary {
  if (values.length === 0) {
    return {
      count: 0,
      mean: 0,
      variance: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      p50: 0,
      p95: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / count;
  const variance =
    sorted.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / count;

  return {
    count,
    mean,
    variance,
    stdDev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[count - 1],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

export function compareDistributions(
  metric: string,
  baselineValues: number[],
  currentValues: number[],
  threshold = DEFAULT_THRESHOLD,
): DistributionComparison {
  const baseline = summarizeDistribution(baselineValues);
  const current = summarizeDistribution(currentValues);
  const meanDelta = current.mean - baseline.mean;
  const relativeMeanDelta =
    baseline.mean === 0
      ? Math.abs(meanDelta)
      : Math.abs(meanDelta) / Math.abs(baseline.mean);
  const stdDevRatio =
    baseline.stdDev === 0
      ? current.stdDev === 0
        ? 1
        : current.stdDev
      : current.stdDev / baseline.stdDev;
  const driftScore = Math.max(relativeMeanDelta, Math.abs(stdDevRatio - 1));

  return {
    metric,
    baseline,
    current,
    meanDelta,
    relativeMeanDelta,
    stdDevRatio,
    driftScore,
    threshold,
    drifted: driftScore >= threshold,
  };
}

function percentile(sortedValues: number[], percentileRank: number): number {
  if (sortedValues.length === 0) return 0;

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileRank) - 1),
  );

  return sortedValues[index];
}
