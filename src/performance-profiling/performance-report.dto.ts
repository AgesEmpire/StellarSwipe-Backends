import { ProfileSessionType } from '../entities/profile-session.entity';
import { BottleneckDto } from './bottleneck.dto';

export class PerformanceSummaryDto {
  // CPU
  avgCpuUsage: number;
  peakCpuUsage: number;
  p95CpuUsage: number;

  // Memory
  avgMemoryMb: number;
  peakMemoryMb: number;
  heapGrowthMb: number;
  heapLeakSuspected: boolean;

  // Queries
  totalQueries: number;
  slowQueriesCount: number;
  avgQueryMs: number;
  p95QueryMs: number;
  p99QueryMs: number;
  uniqueSlowQueries: number;

  // API
  totalApiRequests: number;
  avgApiResponseMs: number;
  p95ApiResponseMs: number;
  p99ApiResponseMs: number;
  errorRate: number;
  slowEndpointsCount: number;
}

export class CpuProfileDto {
  samples: Array<{ timestamp: Date; usagePercent: number; loadAvg1m: number }>;
  peakAt: Date;
  peakValue: number;
  hotspots: Array<{ name: string; selfTimePercent: number; totalTimePercent: number }>;
  flameGraphData?: Record<string, any>;
}

export class MemoryProfileDto {
  samples: Array<{ timestamp: Date; heapUsedMb: number; rssMs: number }>;
  peakAt: Date;
  peakHeapMb: number;
  leakIndicators: Array<{ metric: string; growthPerMinuteMb: number; severity: string }>;
  heapSnapshotUrl?: string;
}

export class QueryProfileDto {
  slowestQueries: Array<{
    query: string;
    avgDurationMs: number;
    maxDurationMs: number;
    count: number;
    table?: string;
    operation: string;
    recommendation: string;
  }>;
  queryDistribution: Record<string, number>;
  indexSuggestions: string[];
}

export class ApiProfileDto {
  slowestEndpoints: Array<{
    method: string;
    route: string;
    avgDurationMs: number;
    p99DurationMs: number;
    requestCount: number;
    errorRate: number;
  }>;
  statusCodeDistribution: Record<string, number>;
  throughputPerMinute: number;
}

export class PerformanceReportDto {
  sessionId: string;
  sessionName: string;
  type: ProfileSessionType;
  startedAt: Date;
  completedAt: Date;
  durationSeconds: number;
  environment: string;
  appVersion: string;

  summary: PerformanceSummaryDto;
  bottlenecks: BottleneckDto[];

  cpu?: CpuProfileDto;
  memory?: MemoryProfileDto;
  queries?: QueryProfileDto;
  api?: ApiProfileDto;

  traceAggregation?: Record<string, any>;
  generatedAt: Date;
}
