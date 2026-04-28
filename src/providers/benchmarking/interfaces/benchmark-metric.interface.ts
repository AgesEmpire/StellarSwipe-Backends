export enum MetricCategory {
  RETURN = 'return',
  RISK = 'risk',
  EFFICIENCY = 'efficiency',
  CONSISTENCY = 'consistency',
}

export enum BenchmarkType {
  PLATFORM = 'platform',
  PEER_GROUP = 'peer_group',
  MARKET_INDEX = 'market_index',
}

export enum PerformanceTier {
  TOP = 'top', // >= 75th percentile
  ABOVE_AVERAGE = 'above_average', // >= 50th
  BELOW_AVERAGE = 'below_average', // >= 25th
  BOTTOM = 'bottom', // < 25th
}

export interface BenchmarkMetric {
  name: string;
  category: MetricCategory;
  providerValue: number;
  benchmarkValue: number;
  delta: number;
  deltaPercent: number;
  percentileRank: number;
  performanceTier: PerformanceTier;
  weight: number;
}

export interface BenchmarkSnapshot {
  providerId: string;
  periodStart: Date;
  periodEnd: Date;
  metrics: BenchmarkMetric[];
  overallScore: number;
  overallPercentile: number;
  overallTier: PerformanceTier;
  benchmarkType: BenchmarkType;
  referenceId: string | null;
}

export interface PlatformStats {
  metricName: string;
  mean: number;
  median: number;
  stdDev: number;
  p25: number;
  p75: number;
  p90: number;
  sampleSize: number;
}
