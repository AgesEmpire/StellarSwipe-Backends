import { BadRequestException } from '@nestjs/common';
import { SearchFiltersDto } from '../dto/search-query.dto';

/**
 * Filter fields the query builder knows how to translate into Elasticsearch
 * clauses. Anything outside this set is rejected rather than silently
 * ignored, so callers find out immediately that a field isn't supported.
 */
export const ALLOWED_SEARCH_FILTER_FIELDS = [
  'assetPair',
  'action',
  'providerId',
  'dateRange',
  'minWinRate',
] as const;

/** Array-valued filters, each of which maps to a single Elasticsearch `terms` clause. */
const ARRAY_FILTER_FIELDS = ['assetPair', 'action', 'providerId'] as const;

/**
 * Maximum number of values a single array filter (e.g. `assetPair`) may
 * contain. Bounds the size of the `terms` clause built from it.
 */
export const MAX_FILTER_VALUES_PER_FIELD = 25;

/**
 * Hard cap on total filter complexity for a single search request, counting
 * every array entry plus the date range and win-rate threshold if present.
 * Prevents a single request from building an excessively expensive query.
 */
export const MAX_TOTAL_FILTER_CLAUSES = 60;

/**
 * Whitelists supported search filter fields/operators and bounds filter
 * complexity before `SearchService` turns them into an Elasticsearch query.
 *
 * Throws `BadRequestException` for unsupported fields, malformed values, or
 * filters that exceed the configured complexity limits. Returns the filters
 * unchanged (never mutated) when they pass validation.
 */
export function validateSearchFilters(
  filters: SearchFiltersDto | null | undefined,
): SearchFiltersDto | undefined {
  if (!filters) {
    return undefined;
  }

  const unknownFields = Object.keys(filters).filter(
    (key) => !(ALLOWED_SEARCH_FILTER_FIELDS as readonly string[]).includes(key),
  );
  if (unknownFields.length > 0) {
    throw new BadRequestException(
      `Unsupported search filter field(s): ${unknownFields.join(', ')}`,
    );
  }

  let totalClauses = 0;

  for (const field of ARRAY_FILTER_FIELDS) {
    const values = (filters as Record<string, unknown>)[field];
    if (values === undefined) {
      continue;
    }
    if (!Array.isArray(values)) {
      throw new BadRequestException(`Search filter "${field}" must be an array`);
    }
    if (values.length > MAX_FILTER_VALUES_PER_FIELD) {
      throw new BadRequestException(
        `Search filter "${field}" supports at most ${MAX_FILTER_VALUES_PER_FIELD} values`,
      );
    }
    totalClauses += values.length;
  }

  if (filters.dateRange) {
    const { from, to } = filters.dateRange;
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('Search filter "dateRange" must contain valid dates');
    }
    if (fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException(
        'Search filter "dateRange.from" must not be after "dateRange.to"',
      );
    }
    totalClauses += 1;
  }

  if (filters.minWinRate !== undefined) {
    if (
      typeof filters.minWinRate !== 'number' ||
      Number.isNaN(filters.minWinRate) ||
      filters.minWinRate < 0 ||
      filters.minWinRate > 100
    ) {
      throw new BadRequestException('Search filter "minWinRate" must be a number between 0 and 100');
    }
    totalClauses += 1;
  }

  if (totalClauses > MAX_TOTAL_FILTER_CLAUSES) {
    throw new BadRequestException(
      `Search request exceeds maximum filter complexity (${MAX_TOTAL_FILTER_CLAUSES} clauses)`,
    );
  }

  return filters;
}
