export interface ProviderFeatures {
  winRate: number;           // 0-1
  reputationScore: number;   // 0-1
  consistency: number;       // 0-1
  avgHoldTimeHours: number;  // Normalized: 0-1 (capped at 168h / 1 week)
  totalSignals: number;      // Normalized: 0-1 (capped at 500)
  recentWinRate: number;     // 0-1 (last 20 signals)
  streakScore: number;       // -1 (loss streak) to 1 (win streak)
}

export interface MarketFeatures {
  assetVolatility: number;   // 0-1 normalized std dev of 24h prices
  marketTrend: number;       // -1 (bear), 0 (neutral), 1 (bull)
  volumeRatio: number;       // Current vs 7d avg volume, 0-1 normalized
  rsiScore: number;          // RSI 14 normalized 0-1
  priceDeviation: number;    // Distance from moving average, normalized 0-1
}

export interface SignalFeatures {
  confidenceScore: number;   // 0-1
  riskRewardRatio: number;   // TP distance / SL distance, normalized 0-1
  timeOfDay: number;         // 0-1 (hour/24)
  dayOfWeek: number;         // 0-1 (day/7)
  assetPairPopularity: number; // 0-1 (signals in last 30d for this pair, capped at 100)
}

export interface IFeatureSet {
  provider: ProviderFeatures;
  market: MarketFeatures;
  signal: SignalFeatures;
}

export const FEATURE_NAMES = [
  // Provider (7)
  'provider.winRate',
  'provider.reputationScore',
  'provider.consistency',
  'provider.avgHoldTimeHours',
  'provider.totalSignals',
  'provider.recentWinRate',
  'provider.streakScore',
  // Market (5)
  'market.assetVolatility',
  'market.marketTrend',
  'market.volumeRatio',
  'market.rsiScore',
  'market.priceDeviation',
  // Signal (5)
  'signal.confidenceScore',
  'signal.riskRewardRatio',
  'signal.timeOfDay',
  'signal.dayOfWeek',
  'signal.assetPairPopularity',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export function featureSetToVector(fs: IFeatureSet): number[] {
  return [
    fs.provider.winRate,
    fs.provider.reputationScore,
    fs.provider.consistency,
    fs.provider.avgHoldTimeHours,
    fs.provider.totalSignals,
    fs.provider.recentWinRate,
    fs.provider.streakScore,
    fs.market.assetVolatility,
    fs.market.marketTrend,
    fs.market.volumeRatio,
    fs.market.rsiScore,
    fs.market.priceDeviation,
    fs.signal.confidenceScore,
    fs.signal.riskRewardRatio,
    fs.signal.timeOfDay,
    fs.signal.dayOfWeek,
    fs.signal.assetPairPopularity,
  ];
}
