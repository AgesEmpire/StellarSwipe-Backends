import { DEFAULT_LIMIT, NormalizedPage, PaginationQueryDto } from './pagination.dto';

/**
 * Builds a single, consistent page/cursor/total-count shape regardless of
 * whether the underlying query used offset pagination or a cursor. Every
 * list endpoint should return `NormalizedPage<T>` produced by one of these
 * helpers so clients get one contract instead of N ad-hoc shapes.
 */

export function normalizeOffsetPage<T>(
  data: T[],
  query: PaginationQueryDto,
  totalCount: number,
): NormalizedPage<T> {
  const limit = query.limit ?? DEFAULT_LIMIT;
  const page = query.page ?? 1;
  const hasNextPage = page * limit < totalCount;

  return {
    data,
    pageInfo: {
      page,
      cursor: null,
      nextCursor: null,
      limit,
      totalCount,
      hasNextPage,
    },
  };
}

export function normalizeCursorPage<T>(
  data: T[],
  query: PaginationQueryDto,
  opts: { nextCursor: string | null; totalCount?: number | null },
): NormalizedPage<T> {
  const limit = query.limit ?? DEFAULT_LIMIT;

  return {
    data,
    pageInfo: {
      page: null,
      cursor: query.cursor ?? null,
      nextCursor: opts.nextCursor,
      limit,
      totalCount: opts.totalCount ?? null,
      hasNextPage: Boolean(opts.nextCursor),
    },
  };
}
