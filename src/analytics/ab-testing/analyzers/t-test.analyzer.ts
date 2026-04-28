/**
 * Welch's t-test for comparing means between two variants.
 */
export function tTest(
  mean1: number,
  std1: number,
  n1: number,
  mean2: number,
  std2: number,
  n2: number,
  confidenceLevel = 0.95,
): { statistic: number; pValue: number; isSignificant: boolean; effectSize: number } {
  const se = Math.sqrt(std1 ** 2 / n1 + std2 ** 2 / n2);
  const statistic = (mean1 - mean2) / se;

  // Welch–Satterthwaite degrees of freedom
  const df =
    Math.pow(std1 ** 2 / n1 + std2 ** 2 / n2, 2) /
    (Math.pow(std1 ** 2 / n1, 2) / (n1 - 1) + Math.pow(std2 ** 2 / n2, 2) / (n2 - 1));

  const pValue = 2 * (1 - tCDF(Math.abs(statistic), df));

  // Cohen's d
  const pooledStd = Math.sqrt((std1 ** 2 + std2 ** 2) / 2);
  const effectSize = Math.abs(mean1 - mean2) / pooledStd;

  const alpha = 1 - confidenceLevel;
  const tCritical = tQuantile(1 - alpha / 2, df);
  const isSignificant = Math.abs(statistic) > tCritical;

  return { statistic, pValue, isSignificant, effectSize };
}

/** Approximation of t-distribution CDF using regularized incomplete beta */
function tCDF(t: number, df: number): number {
  const x = df / (df + t * t);
  return 1 - 0.5 * regularizedBeta(x, df / 2, 0.5);
}

/** Approximate t quantile via bisection */
function tQuantile(p: number, df: number): number {
  let lo = 0, hi = 100;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    tCDF(mid, df) < p ? (lo = mid) : (hi = mid);
  }
  return (lo + hi) / 2;
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Continued fraction via Lentz
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  return front * betaCF(x, a, b);
}

function betaCF(x: number, a: number, b: number): number {
  const maxIter = 100;
  let c = 1, d = 1 - (a + b) * x / (a + 1);
  d = Math.abs(d) < 1e-30 ? 1e-30 : 1 / d;
  let h = d;
  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m;
    let num = m * (b - m) * x / ((a + m2 - 1) * (a + m2));
    d = 1 + num * d; d = Math.abs(d) < 1e-30 ? 1e-30 : d;
    c = 1 + num / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c;
    d = 1 / d; h *= d * c;
    num = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1));
    d = 1 + num * d; d = Math.abs(d) < 1e-30 ? 1e-30 : d;
    c = 1 + num / c; c = Math.abs(c) < 1e-30 ? 1e-30 : c;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-10) break;
  }
  return h;
}

function logGamma(z: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}
