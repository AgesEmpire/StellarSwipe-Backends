import { BadRequestException } from '@nestjs/common';
import {
  MAX_FILTER_VALUES_PER_FIELD,
  MAX_TOTAL_FILTER_CLAUSES,
  validateSearchFilters,
} from './search-filter-validator';

describe('validateSearchFilters', () => {
  it('returns undefined when no filters are provided', () => {
    expect(validateSearchFilters(undefined)).toBeUndefined();
    expect(validateSearchFilters(null)).toBeUndefined();
  });

  it('passes through a well-formed filter set unchanged', () => {
    const filters = {
      assetPair: ['USDC/XLM'],
      action: ['BUY'],
      providerId: ['provider-1'],
      dateRange: { from: '2026-01-01', to: '2026-01-31' },
      minWinRate: 70,
    };
    expect(validateSearchFilters(filters as any)).toEqual(filters);
  });

  it('rejects unsupported filter fields', () => {
    const filters = { assetPair: ['USDC/XLM'], unsupportedField: ['x'] } as any;
    expect(() => validateSearchFilters(filters)).toThrow(BadRequestException);
  });

  it('rejects a non-array value for an array filter field', () => {
    const filters = { assetPair: 'USDC/XLM' } as any;
    expect(() => validateSearchFilters(filters)).toThrow(BadRequestException);
  });

  it('rejects an array filter that exceeds the per-field size limit', () => {
    const filters = {
      assetPair: Array.from({ length: MAX_FILTER_VALUES_PER_FIELD + 1 }, (_, i) => `PAIR-${i}`),
    } as any;
    expect(() => validateSearchFilters(filters)).toThrow(BadRequestException);
  });

  it('allows an array filter right at the per-field size limit', () => {
    const filters = {
      assetPair: Array.from({ length: MAX_FILTER_VALUES_PER_FIELD }, (_, i) => `PAIR-${i}`),
    } as any;
    expect(() => validateSearchFilters(filters)).not.toThrow();
  });

  it('rejects an invalid date range', () => {
    const filters = { dateRange: { from: 'not-a-date', to: '2026-01-31' } } as any;
    expect(() => validateSearchFilters(filters)).toThrow(BadRequestException);
  });

  it('rejects a date range where "from" is after "to"', () => {
    const filters = { dateRange: { from: '2026-02-01', to: '2026-01-01' } } as any;
    expect(() => validateSearchFilters(filters)).toThrow(BadRequestException);
  });

  it('rejects an out-of-range minWinRate', () => {
    expect(() => validateSearchFilters({ minWinRate: -1 } as any)).toThrow(BadRequestException);
    expect(() => validateSearchFilters({ minWinRate: 101 } as any)).toThrow(BadRequestException);
  });

  it('rejects filters whose combined complexity exceeds the total clause cap', () => {
    const filters = {
      assetPair: Array.from({ length: MAX_FILTER_VALUES_PER_FIELD }, (_, i) => `A-${i}`),
      action: Array.from({ length: MAX_FILTER_VALUES_PER_FIELD }, (_, i) => `B-${i}`),
      providerId: Array.from({ length: MAX_FILTER_VALUES_PER_FIELD }, (_, i) => `C-${i}`),
    } as any;
    // 3 * MAX_FILTER_VALUES_PER_FIELD is well past MAX_TOTAL_FILTER_CLAUSES
    expect(3 * MAX_FILTER_VALUES_PER_FIELD).toBeGreaterThan(MAX_TOTAL_FILTER_CLAUSES);
    expect(() => validateSearchFilters(filters)).toThrow(BadRequestException);
  });
});
