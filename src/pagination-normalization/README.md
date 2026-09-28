# Pagination Normalization

A single response contract for paginated list endpoints so clients can rely on
one shape for `page`, `cursor`, and `totalCount` handling regardless of which
endpoint they call.

## Contract

```ts
interface NormalizedPage<T> {
  data: T[];
  pageInfo: {
    page: number | null;        // set for offset-based endpoints
    cursor: string | null;      // set for cursor-based endpoints
    nextCursor: string | null;
    limit: number;
    totalCount: number | null;  // null when not economical to compute (e.g. cursor-only stores)
    hasNextPage: boolean;
  };
}
```

## Usage

```ts
@Get()
async list(@Query() query: PaginationQueryDto) {
  const [data, totalCount] = await this.repo.findAndCount({
    take: query.limit,
    skip: ((query.page ?? 1) - 1) * (query.limit ?? DEFAULT_LIMIT),
  });
  return normalizeOffsetPage(data, query, totalCount);
}
```

or, for cursor-backed sources:

```ts
return normalizeCursorPage(data, query, { nextCursor });
```

`PaginationQueryDto` validates `page`/`cursor`/`limit`/`order` (limit capped at 100,
default 20) via `class-validator`, so malformed input is rejected before hitting a
repository.

## Observability

Attach `PaginationLoggingInterceptor` (globally or per-controller) to log route,
returned count, requested page/cursor, and `hasNextPage` for every response shaped
as `NormalizedPage`, without each controller re-implementing that logging.

## Safety / edge cases

- `limit` is clamped to `[1, 100]`; invalid `page`/`limit` values fail DTO validation
  (400) instead of silently defaulting.
- `hasNextPage` for offset pages is derived from `page * limit < totalCount`, so
  clients don't need to compute it themselves.
- `totalCount` is nullable — cursor-only backends that can't cheaply compute a total
  return `null` rather than an inaccurate number.
