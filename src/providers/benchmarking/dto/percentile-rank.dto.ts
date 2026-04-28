import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  Min,
  Max,
} from 'class-validator';
import {
  MetricCategory,
  PerformanceTier,
} from '../interfaces/benchmark-metric.interface';

export class PercentileRankQueryDto {
  @IsString()
  providerId: string;

  @IsOptional()
  @IsEnum(MetricCategory)
  category?: MetricCategory;
}

export class MetricPercentileDto {
  metricName: string;
  category: MetricCategory;
  providerValue: number;
  percentileRank: number;
  performanceTier: PerformanceTier;
  platformMean: number;
  platformMedian: number;
  platformStdDev: number;
}

export class PercentileRankReportDto {
  providerId: string;
  overallPercentile: number;
  overallTier: PerformanceTier;
  metricRankings: MetricPercentileDto[];
  strongestMetrics: MetricPercentileDto[];
  weakestMetrics: MetricPercentileDto[];
  generatedAt: Date;
}

export class CalculatePercentileDto {
  @IsString()
  providerId: string;

  @IsString()
  metricName: string;

  @IsNumber()
  value: number;
}
