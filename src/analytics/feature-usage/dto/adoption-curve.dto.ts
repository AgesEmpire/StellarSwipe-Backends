import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { UserSegment } from '../entities/feature-usage.entity';
import { AdoptionStage } from '../entities/feature-adoption.entity';

export class AdoptionCurveQueryDto {
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

export class AdoptionDataPointDto {
  date: string;
  uniqueUsers: number;
  newUsers: number;
  returningUsers: number;
  adoptionRate: number;
  retentionRate: number;
  stageBreakdown: Record<AdoptionStage, number> | null;
}

export class AdoptionCurveDto {
  featureKey: string;
  segment: UserSegment | null;
  dataPoints: AdoptionDataPointDto[];
  peakAdoptionRate: number;
  peakDate: string | null;
  currentAdoptionRate: number;
  growthRate: number;
  timeToActivationDays: number | null;
  generatedAt: Date;
}

export class AdoptionCohortDto {
  cohortDate: string;
  cohortSize: number;
  retentionByWeek: Record<number, number>;
  featureKey: string;
}

export class GetAdoptionCohortDto {
  @IsString()
  featureKey: string;

  @IsOptional()
  @IsDateString()
  cohortStart?: string;

  @IsOptional()
  @IsEnum(UserSegment)
  segment?: UserSegment;
}
