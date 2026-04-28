import { LtvInput } from '../interfaces/ltv-model.interface';

/**
 * Historical LTV: simple sum of past revenue projected forward.
 * LTV = avgMonthlyRevenue * (1 / churnRate)
 */
export function calculateHistoricalLtv(input: LtvInput): number {
  const churnRate = Math.max(0.01, input.churnRisk);
  return input.avgMonthlyRevenue / churnRate;
}
