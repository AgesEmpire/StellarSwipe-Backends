import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsDateString,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DecayCurveType, DecayStatus } from '../entities/signal-decay.entity';

export class PerformanceDataPointDto {
  @IsNumber()
  hoursElapsed: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  accuracy: number;

  @IsOptional()
  @IsNumber()
  sampleSize?: number;
}

export class AnalyzeSignalDecayDto {
  @IsString()
  signalId: string;

  @IsString()
  signalType: string;

  @Type(() => PerformanceDataPointDto)
  performanceData: PerformanceDataPointDto[];

  @IsOptional()
  @IsEnum(DecayCurveType)
  preferredCurveType?: DecayCurveType;

  @IsOptional()
  @IsString()
  marketRegime?: string;

  @IsOptional()
  volatilityAdjusted?: boolean;
}

export class DecayAnalysisResultDto {
  signalId: string;
  signalType: string;
  decayCurveType: DecayCurveType;
  status: DecayStatus;
  initialAccuracy: number;
  currentAccuracy: number;
  decayRate: number;
  halfLifeHours: number;
  optimalEntryWindowStart: number | null;
  optimalEntryWindowEnd: number | null;
  recommendedExpiryHours: number;
  rSquared: number | null;
  curveParameters: Record<string, number>;
  performanceByHour: Record<string, number>;
  analyzedAt: Date;
  validUntil: Date | null;
  summary: string;
}

export class GetDecayAnalysisDto {
  @IsString()
  signalId: string;

  @IsOptional()
  @IsEnum(DecayStatus)
  status?: DecayStatus;
}

export class BulkDecayAnalysisDto {
  @IsString({ each: true })
  signalIds: string[];

  @IsOptional()
  @IsString()
  signalType?: string;

  @IsOptional()
  @IsDateString()
  analyzedAfter?: string;
}

export class DecayComparisonDto {
  @IsString({ each: true })
  signalIds: string[];
}
