export type CohortType = 'signup_period' | 'first_trade_period' | 'provider_followed';

export interface CohortConfig {
  cohortType: CohortType;
  period: 'day' | 'week' | 'month';
  lookbackPeriods: number;
}
