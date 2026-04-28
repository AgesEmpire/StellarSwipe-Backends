import { LtvInput } from '../interfaces/ltv-model.interface';

/**
 * Cohort LTV: average LTV for users with similar tenure and tier.
 * Uses a simple cohort multiplier based on months active bucket.
 */
export function calculateCohortLtv(input: LtvInput): number {
  const cohortMultiplier =
    input.monthsActive < 3 ? 0.6 :
    input.monthsActive < 6 ? 0.8 :
    input.monthsActive < 12 ? 1.0 :
    input.monthsActive < 24 ? 1.3 : 1.6;

  const churnRate = Math.max(0.01, input.churnRisk);
  return (input.avgMonthlyRevenue / churnRate) * cohortMultiplier * (0.7 + input.engagementScore * 0.3);
}
