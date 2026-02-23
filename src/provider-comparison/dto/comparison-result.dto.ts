export class MetricComparison {
  value: number;
  rank: number;
  percentile: number;
  isStatisticallySignificant?: boolean;
  sampleSize?: number;
}

export class ProviderComparisonData {
  id: string;
  name: string;
  metrics: {
    winRate?: MetricComparison;
    totalPnL?: MetricComparison;
    consistency?: MetricComparison;
    followers?: MetricComparison;
  };
  overallScore: number;
  totalSignals?: number;
}

export class ComparisonResultDto {
  providers: ProviderComparisonData[];
  recommendation: string;
  timeframe: string;
  comparedAt: Date;
  warnings?: string[];
}
