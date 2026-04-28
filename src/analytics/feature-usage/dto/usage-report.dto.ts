import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { UserSegment } from '../entities/feature-usage.entity';
import {
  FeatureMetricsSummaryDto,
  FeatureRankingDto,
} from './feature-metrics.dto';

export class UsageReportQueryDto {
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
}

export class SegmentBreakdownDto {
  segment: UserSegment;
  totalEvents: number;
  uniqueUsers: number;
  adoptionRate: number;
  topFeatures: string[];
}

export class UsageReportDto {
  periodStart: Date;
  periodEnd: Date;
  totalEvents: number;
  totalUniqueUsers: number;
  totalFeaturesTracked: number;
  mostUsedFeatures: FeatureRankingDto[];
  leastUsedFeatures: FeatureRankingDto[];
  segmentBreakdown: SegmentBreakdownDto[];
  featureMetrics: FeatureMetricsSummaryDto[];
  generatedAt: Date;
}

export class UserFeatureUsageDto {
  userId: string;
  userSegment: UserSegment;
  featuresUsed: number;
  totalEvents: number;
  topFeatures: Array<{
    featureKey: string;
    eventCount: number;
    lastUsedAt: Date;
  }>;
  adoptionStages: Record<string, string>;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
}

export class GetUserFeatureUsageDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
