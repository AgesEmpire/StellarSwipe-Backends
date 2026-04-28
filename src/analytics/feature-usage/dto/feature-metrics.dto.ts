import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsArray,
} from 'class-validator';
import { UserSegment, UsageEventType } from '../entities/feature-usage.entity';
import { AdoptionStage } from '../entities/feature-adoption.entity';

export class TrackFeatureUsageDto {
  @IsString()
  featureKey: string;

  @IsString()
  userId: string;

  @IsOptional()
  @IsEnum(UserSegment)
  userSegment?: UserSegment;

  @IsOptional()
  @IsEnum(UsageEventType)
  eventType?: UsageEventType;

  @IsOptional()
  @IsString()
  featureCategory?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  durationMs?: number;

  @IsOptional()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class BulkTrackFeatureUsageDto {
  events: TrackFeatureUsageDto[];
}

export class FeatureMetricsSummaryDto {
  featureKey: string;
  featureCategory: string | null;
  totalEvents: number;
  uniqueUsers: number;
  adoptionRate: number;
  retentionRate: number;
  errorRate: number;
  avgDurationMs: number | null;
  topSegment: UserSegment | null;
  trend: 'growing' | 'stable' | 'declining';
  trendPercent: number;
}

export class GetFeatureMetricsDto {
  @IsString()
  featureKey: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(UserSegment)
  segment?: UserSegment;
}

export class FeatureRankingDto {
  rank: number;
  featureKey: string;
  featureCategory: string | null;
  totalEvents: number;
  uniqueUsers: number;
  adoptionRate: number;
  trend: 'growing' | 'stable' | 'declining';
}

export class GetFeatureRankingDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(UserSegment)
  segment?: UserSegment;

  @IsOptional()
  @IsString()
  featureCategory?: string;

  @IsOptional()
  limit?: number;
}
