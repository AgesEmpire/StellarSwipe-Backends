import { Controller, Get, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ProviderHealthScoreService } from './provider-health-score.service';
import { ProviderHealthScoreDto, ProviderHealthScoresListDto } from './dto/health-score.dto';

/**
 * HealthScoreController
 *
 * Exposes provider API health scores via internal read-only endpoints.
 * These scores combine latency, error rate, and uptime metrics.
 *
 * NOTE: These endpoints should be restricted to internal/admin access only.
 * Health scores are operational metrics for dashboards and alerting.
 */
@ApiTags('Provider Health Scores')
@Controller('internal/providers/health-scores')
export class HealthScoreController {
  constructor(
    private readonly healthScoreService: ProviderHealthScoreService,
  ) {}

  /**
   * GET /internal/providers/health-scores
   * Returns health scores for all tracked provider endpoints.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get health scores for all provider endpoints',
    description:
      'Returns composite health scores combining latency, error rate, and uptime ' +
      'for each provider API endpoint. Restricted to internal/admin access.',
  })
  @ApiResponse({
    status: 200,
    type: ProviderHealthScoresListDto,
    description: 'Health scores for all endpoints',
  })
  getAllHealthScores(): ProviderHealthScoresListDto {
    const scores = this.healthScoreService.getAllHealthScores();
    return {
      scores: scores as ProviderHealthScoreDto[],
      totalEndpoints: scores.length,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * GET /internal/providers/health-scores/:providerId
   * Returns aggregated health score for a specific provider.
   * Averages metrics across all endpoints for that provider.
   */
  @Get(':providerId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get aggregated health score for a provider',
    description:
      'Returns aggregated health score for a provider by averaging metrics ' +
      'across all of its API endpoints.',
  })
  @ApiParam({ name: 'providerId', description: 'Provider identifier' })
  @ApiResponse({
    status: 200,
    type: ProviderHealthScoreDto,
    description: 'Aggregated health score',
  })
  @ApiResponse({ status: 404, description: 'Provider has no recorded metrics' })
  getProviderHealthScore(
    @Param('providerId') providerId: string,
  ): ProviderHealthScoreDto {
    const score = this.healthScoreService.getProviderHealthScore(providerId);

    if (!score) {
      return {
        providerId,
        endpoint: 'ALL',
        score: 0,
        latencyScore: 0,
        reliabilityScore: 0,
        uptimeScore: 0,
        metrics: {
          avgLatencyMs: 0,
          p95LatencyMs: 0,
          errorRate: 0,
          uptime: 0,
          requestCount: 0,
        },
        status: 'unhealthy',
      };
    }

    return score as ProviderHealthScoreDto;
  }

  /**
   * GET /internal/providers/health-scores/:providerId/:endpoint
   * Returns health score for a specific provider endpoint.
   */
  @Get(':providerId/:endpoint')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get health score for a specific provider endpoint',
  })
  @ApiParam({ name: 'providerId', description: 'Provider identifier' })
  @ApiParam({ name: 'endpoint', description: 'API endpoint path' })
  @ApiResponse({
    status: 200,
    type: ProviderHealthScoreDto,
    description: 'Health score for endpoint',
  })
  @ApiResponse({ status: 404, description: 'Endpoint has no recorded metrics' })
  getEndpointHealthScore(
    @Param('providerId') providerId: string,
    @Param('endpoint') endpoint: string,
  ): ProviderHealthScoreDto {
    const score = this.healthScoreService.getHealthScore(providerId, endpoint);

    if (!score) {
      return {
        providerId,
        endpoint,
        score: 0,
        latencyScore: 0,
        reliabilityScore: 0,
        uptimeScore: 0,
        metrics: {
          avgLatencyMs: 0,
          p95LatencyMs: 0,
          errorRate: 0,
          uptime: 0,
          requestCount: 0,
        },
        status: 'unhealthy',
      };
    }

    return score as ProviderHealthScoreDto;
  }
}
