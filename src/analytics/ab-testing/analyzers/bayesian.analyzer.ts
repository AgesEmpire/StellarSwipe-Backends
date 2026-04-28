/**
 * Bayesian A/B test using Beta-Binomial model.
 * Returns probability that variant beats control and expected uplift.
 */
export function bayesianTest(
  controlConversions: number,
  controlImpressions: number,
  variantConversions: number,
  variantImpressions: number,
  confidenceLevel = 0.95,
): { statistic: number; pValue: number; isSignificant: boolean; effectSize: number } {
  // Beta posterior: Beta(alpha=conversions+1, beta=non-conversions+1)
  const aA = controlConversions + 1;
  const bA = controlImpressions - controlConversions + 1;
  const aB = variantConversions + 1;
  const bB = variantImpressions - variantConversions + 1;

  // P(B > A) via Monte Carlo (10k samples)
  const samples = 10_000;
  let wins = 0;
  for (let i = 0; i < samples; i++) {
    if (betaSample(aB, bB) > betaSample(aA, bA)) wins++;
  }

  const probBWins = wins / samples;
  const isSignificant = probBWins >= confidenceLevel || probBWins <= 1 - confidenceLevel;

  const meanA = aA / (aA + bA);
  const meanB = aB / (aB + bB);
  const effectSize = meanA > 0 ? (meanB - meanA) / meanA : 0;

  return {
    statistic: probBWins,
    pValue: 1 - probBWins,
    isSignificant,
    effectSize,
  };
}

/** Sample from Beta(a, b) using Johnk's method */
function betaSample(a: number, b: number): number {
  if (a === 1 && b === 1) return Math.random();
  // Gamma sampling via Marsaglia-Tsang
  return gammaSample(a) / (gammaSample(a) + gammaSample(b));
}

function gammaSample(shape: number): number {
  if (shape < 1) return gammaSample(1 + shape) * Math.pow(Math.random(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number, v: number;
    do {
      x = normalSample();
      v = 1 + c * x;
    } while (v <= 0);
    v = v ** 3;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x ** 2 + d * (1 - v + Math.log(v))) return d * v;
  }
}

function normalSample(): number {
  let u: number, v: number, s: number;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt((-2 * Math.log(s)) / s);
}
