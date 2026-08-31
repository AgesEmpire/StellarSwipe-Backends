import { normalizeCursorPage, normalizeOffsetPage } from './pagination.util';
import { PaginationQueryDto } from './pagination.dto';

describe('normalizeOffsetPage', () => {
  it('computes hasNextPage from page/limit/totalCount', () => {
    const query: PaginationQueryDto = { page: 1, limit: 10 };
    const result = normalizeOffsetPage(new Array(10).fill({}), query, 25);
    expect(result.pageInfo).toMatchObject({
      page: 1,
      limit: 10,
      totalCount: 25,
      hasNextPage: true,
      cursor: null,
      nextCursor: null,
    });
  });

  it('reports hasNextPage=false on the last page', () => {
    const query: PaginationQueryDto = { page: 3, limit: 10 };
    const result = normalizeOffsetPage(new Array(5).fill({}), query, 25);
    expect(result.pageInfo.hasNextPage).toBe(false);
  });

  it('defaults page and limit when omitted', () => {
    const result = normalizeOffsetPage([], {}, 0);
    expect(result.pageInfo.page).toBe(1);
    expect(result.pageInfo.limit).toBe(20);
  });
});

describe('normalizeCursorPage', () => {
  it('derives hasNextPage from presence of nextCursor', () => {
    const query: PaginationQueryDto = { cursor: 'abc', limit: 5 };
    const result = normalizeCursorPage([{}, {}], query, { nextCursor: 'def' });
    expect(result.pageInfo).toMatchObject({
      cursor: 'abc',
      nextCursor: 'def',
      hasNextPage: true,
      page: null,
    });
  });

  it('has no next page when nextCursor is null', () => {
    const result = normalizeCursorPage([], {}, { nextCursor: null });
    expect(result.pageInfo.hasNextPage).toBe(false);
  });

  it('carries totalCount through when the query can supply it', () => {
    const result = normalizeCursorPage([{}], {}, { nextCursor: null, totalCount: 42 });
    expect(result.pageInfo.totalCount).toBe(42);
  });
});
