/**
 * Rules evaluated for eligibility and enforcement during a trading competition.
 */
export interface CompetitionRules {
  minTradeVolume?: string;
  allowedAssets?: string[];
  maxOpenPositions?: number;
  countClosedTradesOnly?: boolean;
  extensions?: Record<string, unknown>;
}
