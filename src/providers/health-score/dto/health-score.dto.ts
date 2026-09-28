import { ApiProperty } from '@nestjs/swagger';

export class HealthMetricsDto {
  @ApiProperty({ description: 'Average latency in milliseconds', example: 85 })
  avgLatencyMs: number;

  @ApiProperty({ description: 'P95 latency in milliseconds', example: 120 })
  p95LatencyMs: number;

  @ApiProperty({ description: 'Error rate as decimal (0-1)', example: 0.02 })
  errorRate: number;

  @ApiProperty({ description: 'Uptime percentage (0-100)', example: 99.5 })
  uptime: number;

  @ApiProperty({ description: 'Total request count', example: 1250 })
  requestCount: number;
}

export class ProviderHealthScoreDto {
  @ApiProperty({ description: 'Provider identifier', example: 'provider-123' })
  providerId: string;

  @ApiProperty({ description: 'API endpoint path or ALL for aggregate', example: '/api/quotes' })
  endpoint: string;

  @ApiProperty({ description: 'Overall health score (0-100)', example: 87 })
  score: number;

  @ApiProperty({ description: 'Latency component score (0-100)', example: 90 })
  latencyScore: number;

  @ApiProperty({ description: 'Reliability component score (0-100)', example: 98 })
  reliabilityScore: number;

  @ApiProperty({ description: 'Uptime component score (0-100)', example: 99 })
  uptimeScore: number;

  @ApiProperty({ type: HealthMetricsDto })
  metrics: HealthMetricsDto;

  @ApiProperty({
    description: 'Health status',
    enum: ['healthy', 'degraded', 'unhealthy'],
    example: 'healthy',
  })
  status: 'healthy' | 'degraded' | 'unhealthy';
}

export class ProviderHealthScoresListDto {
  @ApiProperty({ description: 'List of provider health scores', type: [ProviderHealthScoreDto] })
  scores: ProviderHealthScoreDto[];

  @ApiProperty({ description: 'Total number of tracked endpoints', example: 12 })
  totalEndpoints: number;

  @ApiProperty({ description: 'Timestamp of the report', example: '2026-06-29T12:00:00Z' })
  timestamp: string;
}
