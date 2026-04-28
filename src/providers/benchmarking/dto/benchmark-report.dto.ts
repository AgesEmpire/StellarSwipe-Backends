import { IsString, IsEnum, IsOptional, IsDateString } from 'class-validator';
import {
  BenchmarkType,
  PerformanceTier,
  BenchmarkMetric,
  PlatformStats,
} from '../interfaces/benchmark-metric.interface';

export class GetBenchmarkReportDto {
  @IsString()
  providerId: string;

  @IsOptional()
  @IsEnum(BenchmarkType)
  benchmarkType?: BenchmarkType;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;
}

export class BenchmarkReportDto {
  providerId: string;
  benchmarkType: BenchmarkType;
  referenceId: string | null;
  periodStart: Date;
  periodEnd: Date;
  overallScore: number;
  overallPercentile: number;
  overallTier: PerformanceTier;
  metrics: BenchmarkMetric[];
  platformStats: PlatformStats[] | null;
  sampleSize: number;
  calculatedAt: Date;
  insights: string[];
}

export class BenchmarkHistoryQueryDto {
  @IsString()
  providerId: string;

  @IsOptional()
  @IsEnum(BenchmarkType)
  benchmarkType?: BenchmarkType;

  @IsOptional()
  @IsDateString()
  after?: string;

  @IsOptional()
  @IsDateString()
  before?: string;
}

export class BenchmarkHistoryDto {
  providerId: string;
  entries: Array<{
    periodStart: Date;
    periodEnd: Date;
    overallScore: number;
    overallPercentile: number;
    overallTier: PerformanceTier;
    benchmarkType: BenchmarkType;
    calculatedAt: Date;
  }>;
}
