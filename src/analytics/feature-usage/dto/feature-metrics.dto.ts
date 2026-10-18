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

/**
 * Per-item outcome for one event in a `POST /analytics/features/track/bulk`
 * request (#1382) — every input event gets a stable entry here, indexed to
 * match its position in the request's `events` array, so a partial failure
 * (e.g. one malformed event) never silently drops information about which
 * events were and weren't tracked.
 */
export class BulkTrackFeatureUsageItemResultDto {
  index: number;
  status: 'tracked' | 'failed';
  error?: string;
}

export class BulkTrackFeatureUsageResponseDto {
  tracked: number;
  failed: number;
  results: BulkTrackFeatureUsageItemResultDto[];
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
