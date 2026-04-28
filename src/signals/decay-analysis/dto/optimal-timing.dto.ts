import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  Min,
  Max,
} from 'class-validator';

export enum MarketSession {
  ASIAN = 'asian',
  EUROPEAN = 'european',
  AMERICAN = 'american',
  OVERLAP = 'overlap',
}

export class OptimalTimingQueryDto {
  @IsString()
  signalType: string;

  @IsOptional()
  @IsEnum(MarketSession)
  marketSession?: MarketSession;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minAccuracyThreshold?: number;

  @IsOptional()
  @IsString()
  marketRegime?: string;
}

export class TimingWindowDto {
  startHour: number;
  endHour: number;
  expectedAccuracy: number;
  confidenceScore: number;
  sampleCount: number;
}

export class OptimalTimingResultDto {
  signalType: string;
  optimalWindows: TimingWindowDto[];
  peakPerformanceHour: number;
  avoidanceWindows: TimingWindowDto[];
  recommendedMaxLifespanHours: number;
  averageHalfLifeHours: number;
  dataPoints: number;
  generatedAt: Date;
  insights: string[];
}

export class SignalLifespanRecommendationDto {
  signalId: string;
  signalType: string;
  currentAgeHours: number;
  remainingLifespanHours: number;
  currentAccuracyEstimate: number;
  shouldExpire: boolean;
  expiryReason: string | null;
  nextEvaluationHours: number;
}
