import { LtvInput } from '../interfaces/ltv-model.interface';

const TIER_MULTIPLIER: Record<string, number> = {
  free: 0.5,
  basic: 1.0,
  pro: 2.0,
  enterprise: 4.0,
};

/**
 * Predictive LTV using engagement, tier, and trade activity.
 * Discounted cash flow over forecastMonths with monthly churn decay.
 */
export function calculatePredictiveLtv(input: LtvInput, forecastMonths = 12): number {
  const tierMult = TIER_MULTIPLIER[input.subscriptionTier] ?? 1;
  const tradeRevenue = input.totalTradeVolume > 0
    ? (input.totalTradeVolume / Math.max(1, input.monthsActive)) * 0.001
    : 0;
  const baseMonthly = (input.avgMonthlyRevenue + tradeRevenue) * tierMult * (0.5 + input.engagementScore * 0.5);
  const survivalRate = 1 - input.churnRisk;

  let ltv = 0;
  for (let m = 1; m <= forecastMonths; m++) {
    ltv += baseMonthly * Math.pow(survivalRate, m);
  }
  return Math.max(0, ltv);
}

export function forecastMonthly(input: LtvInput, forecastMonths = 12) {
  const tierMult = TIER_MULTIPLIER[input.subscriptionTier] ?? 1;
  const tradeRevenue = input.totalTradeVolume > 0
    ? (input.totalTradeVolume / Math.max(1, input.monthsActive)) * 0.001
    : 0;
  const baseMonthly = (input.avgMonthlyRevenue + tradeRevenue) * tierMult * (0.5 + input.engagementScore * 0.5);
  const survivalRate = 1 - input.churnRisk;

  let cumulative = 0;
  return Array.from({ length: forecastMonths }, (_, i) => {
    const revenue = baseMonthly * Math.pow(survivalRate, i + 1);
    cumulative += revenue;
    return { month: i + 1, revenue, cumulative };
  });
}
