import { IsOptional, IsString, IsInt, Min, Max, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum SortBy {
  RECENT = 'recent',
  POPULAR = 'popular',
  PERFORMANCE = 'performance',
  RANKED = 'ranked',
}

export class SignalFeedQueryDto {
  @ApiPropertyOptional({ description: 'Cursor for cursor-based pagination' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Page number for page-based pagination', minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiPropertyOptional({ example: 'USDC/XLM' })
  @IsOptional()
  @IsString()
  asset?: string;

  @ApiPropertyOptional({ example: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ enum: SortBy, default: SortBy.RANKED })
  @IsOptional()
  @IsEnum(SortBy)
  sortBy?: SortBy = SortBy.RANKED;
}