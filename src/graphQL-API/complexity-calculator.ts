import { ComplexityEstimatorArgs } from 'graphql-query-complexity';

/**
 * Base multiplier per field resolution.
 * Nested list fields multiply this value by the expected count.
 */
const BASE_COST = 1;
const LIST_MULTIPLIER = 10; // assume up to 10 items per list by default

/**
 * Simple field-cost estimator.
 * Flat scalar fields cost 1; list fields cost LIST_MULTIPLIER * child complexity.
 */
export function simpleComplexityEstimator() {
  return ({ field, args, childComplexity }: ComplexityEstimatorArgs): number => {
    const isList =
      field.type.toString().includes('[') ||
      (field.type as any).ofType?.toString().includes('[');

    if (isList) {
      const requestedLimit =
        (args as Record<string, any>)?.pagination?.limit ??
        (args as Record<string, any>)?.limit ??
        LIST_MULTIPLIER;
      return BASE_COST + childComplexity * Math.min(requestedLimit, 100);
    }

    return BASE_COST + childComplexity;
  };
}

/**
 * Per-field override map.
 * Use this to assign fixed costs to expensive resolver fields
 * (e.g., fields that make external API calls).
 */
export const FIELD_COMPLEXITY_OVERRIDES: Record<string, number> = {
  // portfolio.performance requires multiple aggregation queries
  'PortfolioType.performance': 5,
  // provider.stats requires aggregation across signals table
  'ProviderType.stats': 5,
  // trade summary is an aggregation query
  'Query.tradeSummary': 8,
};

/**
 * Returns the maximum allowed complexity per operation.
 * Can be tightened per role if needed.
 */
export function getComplexityLimit(role?: string): number {
  switch (role) {
    case 'admin':
      return 2000;
    case 'pro':
      return 1000;
    default:
      return 500;
  }
}
