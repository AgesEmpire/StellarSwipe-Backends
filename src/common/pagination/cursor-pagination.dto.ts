import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export class CursorPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number = DEFAULT_PAGE_LIMIT;

  /** Opaque cursor returned as `nextCursor` / `prevCursor` */
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsIn(['next', 'prev'])
  direction?: 'next' | 'prev' = 'next';
}

export interface CursorPageMeta {
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextCursor: string | null;
  prevCursor: string | null;
}

export interface CursorPage<T> {
  data: T[];
  meta: CursorPageMeta;
}
