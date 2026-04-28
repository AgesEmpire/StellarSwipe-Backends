export interface LtvInput {
  userId: string;
  subscriptionTier: 'free' | 'basic' | 'pro' | 'enterprise';
  monthsActive: number;
  totalTradeVolume: number;
  tradeCount: number;
  avgMonthlyRevenue: number;
  engagementScore: number; // 0–1
  churnRisk: number;       // 0–1
}

export interface LtvResult {
  userId: string;
  predictedLtv: number;
  historicalLtv: number;
  cohortLtv: number;
  segment: 'high' | 'medium' | 'low';
  forecastMonths: number;
  confidence: number;
}
