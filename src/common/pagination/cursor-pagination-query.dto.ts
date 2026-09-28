import { IsOptional, IsInt, Min, Max, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Cursor-based pagination query DTO for REST endpoints.
 *
 * Supports both cursor-based and legacy offset-based pagination for backward
 * compatibility.  When `after` is provided, cursor-based pagination is used;
 * otherwise falls back to `page`/`limit`.
 */
export class CursorPaginationQueryDto {
  @ApiPropertyOptional({ description: 'Opaque cursor from a previous response' })
  @IsOptional()
  @IsString()
  after?: string;

  @ApiPropertyOptional({ description: 'Opaque cursor for backward pagination' })
  @IsOptional()
  @IsString()
  before?: string;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  // Legacy offset-based fallback params
  @ApiPropertyOptional({ description: 'Page number (1-based, legacy)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Whether cursor-based pagination is being used */
  get isCursorBased(): boolean {
    return !!(this.after || this.before);
  }

  /** Compute offset for legacy pagination */
  get offset(): number {
    return ((this.page ?? 1) - 1) * (this.limit ?? 20);
  }
}
