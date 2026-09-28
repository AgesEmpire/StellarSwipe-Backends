import { Injectable, Logger } from '@nestjs/common';

/**
 * Cursor-based pagination helper.
 *
 * Encodes/decodes opaque cursors that embed the last-seen sort value and ID,
 * enabling stable, forward-only and backward pagination without OFFSET.
 *
 * Cursor format: base64(JSON({ sortValue, id }))
 */
export interface CursorPaginationOptions {
  /** Maximum page size (default 20, max 100) */
  limit?: number;
  /** Opaque cursor from a previous response */
  after?: string;
  /** Opaque cursor for backward pagination */
  before?: string;
}

export interface CursorPage<T> {
  data: T[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
    totalCount?: number;
  };
}

interface EncodedCursor {
  sortValue: string | number;
  id: string;
}

@Injectable()
export class CursorPaginationService {
  private readonly logger = new Logger(CursorPaginationService.name);

  private readonly DEFAULT_LIMIT = 20;
  private readonly MAX_LIMIT = 100;

  /**
   * Decode an opaque cursor string.
   * Returns `null` if the cursor is invalid or missing.
   */
  decodeCursor(cursor: string | undefined): EncodedCursor | null {
    if (!cursor) return null;
    try {
      const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed.id === 'string' && parsed.sortValue !== undefined) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Encode a cursor from sort value + entity ID.
   */
  encodeCursor(sortValue: string | number, id: string): string {
    const payload: EncodedCursor = { sortValue, id };
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
  }

  /**
   * Validate and normalize pagination options.
   */
  normalizeOptions(options: CursorPaginationOptions): { limit: number; after: EncodedCursor | null; before: EncodedCursor | null } {
    const limit = Math.min(Math.max(options.limit ?? this.DEFAULT_LIMIT, 1), this.MAX_LIMIT);
    return {
      limit,
      after: this.decodeCursor(options.after),
      before: this.decodeCursor(options.before),
    };
  }

  /**
   * Build a CursorPage from fetched results.
   *
   * @param entities      Fetched entities (limit + 1 to detect hasNextPage)
   * @param limit         Requested page size
   * @param sortKeyFn     Function to extract the sort value from an entity
   * @param idKeyFn       Function to extract the entity ID (default: entity.id)
   * @param direction     'forward' or 'backward'
   */
  buildPage<T>(
    entities: T[],
    limit: number,
    sortKeyFn: (entity: T) => string | number,
    idKeyFn: (entity: T) => string = (e: any) => e.id,
    direction: 'forward' | 'backward' = 'forward',
    totalCount?: number,
  ): CursorPage<T> {
    const hasMore = entities.length > limit;
    const data = hasMore ? entities.slice(0, limit) : entities;

    // For backward pagination, reverse the results back to natural order
    const orderedData = direction === 'backward' ? [...data].reverse() : data;

    return {
      data: orderedData,
      pageInfo: {
        hasNextPage: direction === 'forward' ? hasMore : (totalCount !== undefined ? totalCount > limit : false),
        hasPreviousPage: direction === 'backward' ? hasMore : false,
        startCursor: orderedData.length > 0
          ? this.encodeCursor(sortKeyFn(orderedData[0]), idKeyFn(orderedData[0]))
          : null,
        endCursor: orderedData.length > 0
          ? this.encodeCursor(sortKeyFn(orderedData[orderedData.length - 1]), idKeyFn(orderedData[orderedData.length - 1]))
          : null,
        totalCount,
      },
    };
  }

  /**
   * Build backward-compatible offset-based page info for clients that haven't
   * migrated to cursor-based pagination yet.
   */
  buildLegacyPageInfo<T>(
    data: T[],
    total: number,
    page: number,
    limit: number,
  ): {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  } {
    const totalPages = Math.ceil(total / limit);
    return {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    };
  }
}
