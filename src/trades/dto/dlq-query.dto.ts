import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class FailedTradesQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-indexed)',
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({
    description: 'Number of items per page (max 100)',
    default: 20,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Sort field',
    default: 'updatedAt',
  })
  @IsOptional()
  @IsString()
  @IsIn(['updatedAt', 'createdAt', 'amount', 'baseAsset'])
  sortBy?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    default: 'DESC',
  })
  @IsOptional()
  @IsString()
  @IsIn(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC';

  @ApiPropertyOptional({
    description: 'Filter by base asset',
  })
  @IsOptional()
  @IsString()
  baseAsset?: string;

  @ApiPropertyOptional({
    description: 'Filter by error message substring',
  })
  @IsOptional()
  @IsString()
  errorFilter?: string;
}

export class AdminFailedJobsQueryDto {
  @ApiPropertyOptional({
    description: 'Maximum number of recent jobs to return',
    default: 10,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filter by user ID',
  })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Filter by date range start (ISO string)',
  })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Filter by date range end (ISO string)',
  })
  @IsOptional()
  @IsString()
  endDate?: string;
}
