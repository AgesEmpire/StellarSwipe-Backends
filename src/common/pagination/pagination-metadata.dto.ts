import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationLinks } from './pagination-links.util';

/**
 * Standardized pagination metadata returned alongside list endpoints.
 *
 * This DTO provides a consistent contract for all paginated API responses,
 * including page-based and cursor-based pagination support.
 *
 * @example
 * {
 *   "page": 1,
 *   "limit": 20,
 *   "total": 150,
 *   "totalPages": 8,
 *   "hasNext": true,
 *   "hasPrev": false,
 *   "nextCursor": null,
 *   "links": { "self": "...", "first": "...", "last": "...", "next": "...", "prev": null }
 * }
 */
export class PaginationMetaDto {
  /** Current page number (1-based). Omitted for cursor-based pagination. */
  @ApiPropertyOptional({ example: 1 })
  page?: number;

  /** Number of items per page. */
  @ApiProperty({ example: 20 })
  limit!: number;

  /** Total number of items across all pages. */
  @ApiProperty({ example: 150 })
  total!: number;

  /** Total number of pages. Omitted for cursor-based pagination. */
  @ApiPropertyOptional({ example: 8 })
  totalPages?: number;

  /** Whether there is a next page available. */
  @ApiProperty({ example: true })
  hasNext!: boolean;

  /** Whether there is a previous page available. */
  @ApiProperty({ example: false })
  hasPrev!: boolean;

  /** Opaque cursor for the next page (cursor-based pagination). */
  @ApiPropertyOptional({ nullable: true, example: 'eyJvZmZzZXQiOj...' })
  nextCursor?: string | null;

  /** HATEOAS navigation links. */
  @ApiPropertyOptional()
  links?: PaginationLinks;
}

/**
 * Standardized paginated list response wrapper.
 *
 * Wraps the data array alongside standardized pagination metadata so that
 * all list endpoints return a consistent shape to API consumers.
 *
 * @typeParam T - The type of each item in the data array.
 */
export class PaginatedResultDto<T> {
  /** The list of items for the current page. */
  @ApiProperty({ isArray: true })
  data!: T[];

  /** Pagination metadata. */
  @ApiProperty({ type: PaginationMetaDto })
  pagination!: PaginationMetaDto;
}

/**
 * Helper to build PaginationMetaDto from query parameters and a total count.
 */
export function buildPaginationMeta(options: {
  page?: number;
  limit: number;
  total: number;
  totalPages?: number;
  nextCursor?: string | null;
  links?: PaginationLinks;
}): PaginationMetaDto {
  const page = options.page ?? 1;
  const limit = options.limit;
  const total = options.total;
  const totalPages = options.totalPages ?? Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    nextCursor: options.nextCursor ?? null,
    links: options.links,
  };
}

/**
 * Helper to build a PaginatedResultDto from data and pagination options.
 */
export function buildPaginatedResult<T>(
  data: T[],
  options: {
    page?: number;
    limit: number;
    total: number;
    totalPages?: number;
    nextCursor?: string | null;
    links?: PaginationLinks;
  },
): PaginatedResultDto<T> {
  return {
    data,
    pagination: buildPaginationMeta(options),
  };
}
