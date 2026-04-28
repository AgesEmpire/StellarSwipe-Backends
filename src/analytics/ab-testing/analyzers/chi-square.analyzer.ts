/**
 * Chi-square critical values for common confidence levels (df=1)
 */
const CHI2_CRITICAL: Record<number, number> = {
  0.90: 2.706,
  0.95: 3.841,
  0.99: 6.635,
};

export function chiSquareTest(
  controlConversions: number,
  controlImpressions: number,
  variantConversions: number,
  variantImpressions: number,
  confidenceLevel = 0.95,
): { statistic: number; pValue: number; isSignificant: boolean; effectSize: number } {
  const total = controlImpressions + variantImpressions;
  const totalConversions = controlConversions + variantConversions;
  const totalNonConversions = total - totalConversions;

  const eCC = (controlImpressions * totalConversions) / total;
  const eCN = (controlImpressions * totalNonConversions) / total;
  const eVC = (variantImpressions * totalConversions) / total;
  const eVN = (variantImpressions * totalNonConversions) / total;

  const statistic =
    Math.pow(controlConversions - eCC, 2) / eCC +
    Math.pow(controlImpressions - controlConversions - eCN, 2) / eCN +
    Math.pow(variantConversions - eVC, 2) / eVC +
    Math.pow(variantImpressions - variantConversions - eVN, 2) / eVN;

  const pValue = 1 - chiSquareCDF(statistic);
  const critical = CHI2_CRITICAL[confidenceLevel] ?? CHI2_CRITICAL[0.95];
  const effectSize = Math.sqrt(statistic / total); // Cramér's V

  return { statistic, pValue, isSignificant: statistic > critical, effectSize };
}

function chiSquareCDF(x: number): number {
  return regularizedGammaP(0.5, x / 2);
}

function regularizedGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n < 100; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < 1e-10) break;
  }
  return Math.min(1, sum * Math.exp(-x + a * Math.log(x) - logGamma(a)));
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
