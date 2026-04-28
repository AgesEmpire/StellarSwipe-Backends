import { IsString, IsOptional, IsArray } from 'class-validator';
import {
  PerformanceTier,
  BenchmarkMetric,
} from '../interfaces/benchmark-metric.interface';

export class PeerComparisonQueryDto {
  @IsString()
  providerId: string;

  @IsOptional()
  @IsString()
  peerGroupKey?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  peerProviderIds?: string[];
}

export class PeerProviderSummaryDto {
  providerId: string;
  overallScore: number;
  overallPercentile: number;
  overallTier: PerformanceTier;
  rankInGroup: number;
}

export class PeerComparisonReportDto {
  providerId: string;
  peerGroupKey: string | null;
  peerGroupSize: number;
  subjectRank: number;
  subjectScore: number;
  subjectPercentile: number;
  subjectTier: PerformanceTier;
  metricComparisons: Array<{
    metricName: string;
    subjectValue: number;
    peerMedian: number;
    peerP25: number;
    peerP75: number;
    subjectPercentileInPeer: number;
  }>;
  topPeers: PeerProviderSummaryDto[];
  bottomPeers: PeerProviderSummaryDto[];
  generatedAt: Date;
}
