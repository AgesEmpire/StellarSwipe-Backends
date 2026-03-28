import { VariantMetrics } from '../interfaces/statistical-test.interface';

/**
 * Minimum sample size per variant for desired power.
 * Uses standard formula: n = (z_alpha/2 + z_beta)^2 * 2*p*(1-p) / delta^2
 */
export function minimumSampleSize(
  baselineRate: number,
  minimumDetectableEffect: number,
  confidenceLevel = 0.95,
  power = 0.8,
): number {
  const zAlpha = confidenceLevel >= 0.99 ? 2.576 : confidenceLevel >= 0.95 ? 1.96 : 1.645;
  const zBeta = power >= 0.9 ? 1.282 : 0.842;
  const p = baselineRate;
  const delta = minimumDetectableEffect;
  return Math.ceil(Math.pow(zAlpha + zBeta, 2) * 2 * p * (1 - p) / Math.pow(delta, 2));
}

/**
 * Determine winning variant by highest conversion rate.
 */
export function findWinner(variants: VariantMetrics[]): VariantMetrics | null {
  if (!variants.length) return null;
  return variants.reduce((best, v) => (v.conversionRate > best.conversionRate ? v : best));
}

/**
 * Relative uplift of variant over control.
 */
export function relativeUplift(controlRate: number, variantRate: number): number {
  if (controlRate === 0) return 0;
  return (variantRate - controlRate) / controlRate;
}
