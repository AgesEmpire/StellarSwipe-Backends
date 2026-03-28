/**
 * Wilson score confidence interval for a proportion.
 */
export function confidenceInterval(
  conversions: number,
  impressions: number,
  confidenceLevel = 0.95,
): [number, number] {
  const z = zScore(confidenceLevel);
  const p = conversions / impressions;
  const n = impressions;
  const z2 = z * z;
  const center = (p + z2 / (2 * n)) / (1 + z2 / n);
  const margin = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

const Z_SCORES: Record<number, number> = {
  0.90: 1.645,
  0.95: 1.96,
  0.99: 2.576,
};

function zScore(confidenceLevel: number): number {
  return Z_SCORES[confidenceLevel] ?? Z_SCORES[0.95];
}
