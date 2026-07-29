/**
 * Utility functions for statistical distribution analysis used in drift detection.
 *
 * Provides Population Stability Index (PSI) and Jensen-Shannon divergence
 * to quantify how much a current distribution has shifted from a baseline.
 */

export interface DistributionBucket {
  /** Lower bound of the bucket (inclusive) */
  min: number;
  /** Upper bound of the bucket (exclusive) */
  max: number;
  /** Fraction of observations that fall in this bucket (0–1) */
  frequency: number;
}

export interface DriftScore {
  /** PSI value — < 0.1 stable, 0.1–0.2 minor drift, > 0.2 significant drift */
  psi: number;
  /** Jensen-Shannon divergence (0–1 scale) */
  jsDivergence: number;
  /** Mean of the current distribution */
  currentMean: number;
  /** Mean of the baseline distribution */
  baselineMean: number;
  /** Standard deviation of the current distribution */
  currentStdDev: number;
  /** Standard deviation of the baseline distribution */
  baselineStdDev: number;
  /** Relative mean shift as a fraction of baseline mean */
  meanShiftRatio: number;
}

const EPSILON = 1e-10;

/**
 * Compute the mean of a numeric array.
 */
export function computeMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Compute the population standard deviation of a numeric array.
 */
export function computeStdDev(values: number[], mean?: number): number {
  if (values.length < 2) return 0;
  const mu = mean ?? computeMean(values);
  const variance = values.reduce((sum, v) => sum + (v - mu) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Build equal-width histogram buckets from a set of values.
 *
 * @param values   Raw numeric observations
 * @param numBins  Number of histogram bins (default 10)
 */
export function buildHistogram(values: number[], numBins = 10): DistributionBucket[] {
  if (values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);

  // Avoid zero-width buckets when all values are identical
  const range = max - min || 1;
  const binWidth = range / numBins;

  const counts = new Array<number>(numBins).fill(0);

  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / binWidth), numBins - 1);
    counts[idx]++;
  }

  return counts.map((count, i) => ({
    min: min + i * binWidth,
    max: min + (i + 1) * binWidth,
    frequency: count / values.length,
  }));
}

/**
 * Calculate the Population Stability Index (PSI) between two distributions.
 *
 * PSI = Σ (current_i − baseline_i) × ln(current_i / baseline_i)
 *
 * Interpretation:
 *  - PSI < 0.10  → no significant change
 *  - PSI 0.10–0.20 → moderate change, monitor
 *  - PSI > 0.20  → significant shift, investigate
 */
export function calculatePSI(
  baseline: DistributionBucket[],
  current: DistributionBucket[],
): number {
  if (baseline.length !== current.length || baseline.length === 0) return 0;

  let psi = 0;
  for (let i = 0; i < baseline.length; i++) {
    const b = Math.max(baseline[i].frequency, EPSILON);
    const c = Math.max(current[i].frequency, EPSILON);
    psi += (c - b) * Math.log(c / b);
  }
  return psi;
}

/**
 * Calculate the Jensen-Shannon divergence between two distributions.
 * Returns a value in [0, 1] where 0 means identical distributions.
 */
export function calculateJSDivergence(
  baseline: DistributionBucket[],
  current: DistributionBucket[],
): number {
  if (baseline.length !== current.length || baseline.length === 0) return 0;

  let js = 0;
  for (let i = 0; i < baseline.length; i++) {
    const p = Math.max(baseline[i].frequency, EPSILON);
    const q = Math.max(current[i].frequency, EPSILON);
    const m = (p + q) / 2;
    js += 0.5 * p * Math.log(p / m) + 0.5 * q * Math.log(q / m);
  }
  // Normalise to [0, 1]
  return Math.min(js / Math.log(2), 1);
}

/**
 * Compute a full DriftScore comparing a current sample against a baseline sample.
 *
 * @param baselineValues  Historical / reference observations
 * @param currentValues   Recent observations to compare
 * @param numBins         Histogram resolution (default 10)
 */
export function analyzeDrift(
  baselineValues: number[],
  currentValues: number[],
  numBins = 10,
): DriftScore {
  const baselineMean = computeMean(baselineValues);
  const currentMean = computeMean(currentValues);
  const baselineStdDev = computeStdDev(baselineValues, baselineMean);
  const currentStdDev = computeStdDev(currentValues, currentMean);

  // Build histograms over the combined range so buckets align
  const allValues = [...baselineValues, ...currentValues];
  const globalMin = Math.min(...allValues);
  const globalMax = Math.max(...allValues);
  const range = globalMax - globalMin || 1;
  const binWidth = range / numBins;

  const baselineCounts = new Array<number>(numBins).fill(0);
  const currentCounts = new Array<number>(numBins).fill(0);

  for (const v of baselineValues) {
    const idx = Math.min(Math.floor((v - globalMin) / binWidth), numBins - 1);
    baselineCounts[idx]++;
  }
  for (const v of currentValues) {
    const idx = Math.min(Math.floor((v - globalMin) / binWidth), numBins - 1);
    currentCounts[idx]++;
  }

  const baselineBuckets: DistributionBucket[] = baselineCounts.map((count, i) => ({
    min: globalMin + i * binWidth,
    max: globalMin + (i + 1) * binWidth,
    frequency: baselineValues.length > 0 ? count / baselineValues.length : 0,
  }));

  const currentBuckets: DistributionBucket[] = currentCounts.map((count, i) => ({
    min: globalMin + i * binWidth,
    max: globalMin + (i + 1) * binWidth,
    frequency: currentValues.length > 0 ? count / currentValues.length : 0,
  }));

  const psi = calculatePSI(baselineBuckets, currentBuckets);
  const jsDivergence = calculateJSDivergence(baselineBuckets, currentBuckets);
  const meanShiftRatio = baselineMean !== 0 ? Math.abs(currentMean - baselineMean) / Math.abs(baselineMean) : 0;

  return {
    psi,
    jsDivergence,
    currentMean,
    baselineMean,
    currentStdDev,
    baselineStdDev,
    meanShiftRatio,
  };
}
