import { IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ActivityType } from '../entities/activity.entity';

export class ActivityFeedQueryDto {
  @ApiPropertyOptional({
    description: 'Comma-separated activity types to filter by',
    example: 'TRADE_EXECUTED,SWIPE_RIGHT',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map((v: string) => v.trim()) : value,
  )
  @IsEnum(ActivityType, { each: true })
  type?: ActivityType[];

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ActivityResponseDto {
  id: string;
  userId: string;
  type: ActivityType;
  metadata: Record<string, any>;
  createdAt: Date;
  description: string;
}

export class ActivityFeedResponseDto {
  data: ActivityResponseDto[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export class LogActivityDto {
  userId: string;
  type: ActivityType;
  metadata?: Record<string, any>;
}
