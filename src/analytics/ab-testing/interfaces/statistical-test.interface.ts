export interface StatisticalTestResult {
  testType: 'chi-square' | 't-test' | 'bayesian';
  statistic: number;
  pValue: number;
  isSignificant: boolean;
  confidenceLevel: number;
  confidenceInterval: [number, number];
  effectSize: number;
  recommendation: 'adopt' | 'reject' | 'continue';
  reason: string;
}

export interface VariantMetrics {
  variantId: string;
  name: string;
  impressions: number;
  conversions: number;
  conversionRate: number;
  mean?: number;
  stdDev?: number;
  sampleSize?: number;
}
