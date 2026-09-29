import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import {
  CursorPage,
  CursorPaginationDto,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from './cursor-pagination.dto';
import { decodeCursor, encodeCursor } from './cursor.util';

export interface CursorPaginateOptions {
  /** Sort column property, e.g. 'createdAt'. Ties are broken by `id`. */
  sortField?: string;
  order?: 'ASC' | 'DESC';
}

/**
 * Keyset pagination over (sortField, id). Because each page is anchored on the
 * last seen row's values (not an offset), inserts/deletes between requests do
 * not cause skipped or duplicated rows.
 */
export async function cursorPaginate<T extends ObjectLiteral & { id: string }>(
  qb: SelectQueryBuilder<T>,
  dto: CursorPaginationDto,
  { sortField = 'createdAt', order = 'DESC' }: CursorPaginateOptions = {},
): Promise<CursorPage<T>> {
  const limit = Math.min(Math.max(dto.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
  const backward = dto.direction === 'prev';
  const alias = qb.alias;
  const col = `${alias}.${sortField}`;
  const idCol = `${alias}.id`;
  // When paging backwards, flip the sort so we fetch rows nearest the cursor, then reverse.
  const effectiveOrder = backward ? (order === 'ASC' ? 'DESC' : 'ASC') : order;
  const cmp = effectiveOrder === 'ASC' ? '>' : '<';

  if (dto.cursor) {
    const { v, id } = decodeCursor(dto.cursor);
    const value = sortField.toLowerCase().endsWith('at') ? new Date(v) : v;
    qb.andWhere(`(${col}, ${idCol}) ${cmp} (:cursorValue, :cursorId)`, {
      cursorValue: value,
      cursorId: id,
    });
  }

  qb.orderBy(col, effectiveOrder).addOrderBy(idCol, effectiveOrder).take(limit + 1);

  const rows = await qb.getMany();
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  if (backward) data.reverse();

  const toCursor = (row?: T) => {
    if (!row) return null;
    const raw = row[sortField];
    return encodeCursor({ v: raw instanceof Date ? raw.toISOString() : raw, id: row.id });
  };

  const hasNextPage = backward ? !!dto.cursor : hasMore;
  const hasPrevPage = backward ? hasMore : !!dto.cursor;

  return {
    data,
    meta: {
      limit,
      hasNextPage,
      hasPrevPage,
      nextCursor: hasNextPage ? toCursor(data[data.length - 1]) : null,
      prevCursor: hasPrevPage ? toCursor(data[0]) : null,
    },
  };
}
