import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Shared query DTO so every list endpoint accepts the same page/cursor/limit
 * params instead of each controller inventing its own.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit?: number = DEFAULT_LIMIT;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}

export interface PageInfo {
  page: number | null;
  cursor: string | null;
  nextCursor: string | null;
  limit: number;
  totalCount: number | null;
  hasNextPage: boolean;
}

export interface NormalizedPage<T> {
  data: T[];
  pageInfo: PageInfo;
}

export { DEFAULT_LIMIT, MAX_LIMIT };
