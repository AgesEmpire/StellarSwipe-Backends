import { Controller, Get, Post, Body, Query, Logger } from '@nestjs/common';
import { FeatureTrackerService } from './feature-tracker.service';
import {
  TrackFeatureUsageDto,
  BulkTrackFeatureUsageDto,
  GetFeatureMetricsDto,
  GetFeatureRankingDto,
} from './dto/feature-metrics.dto';
import {
  UsageReportQueryDto,
  GetUserFeatureUsageDto,
} from './dto/usage-report.dto';
import { AdoptionCurveQueryDto } from './dto/adoption-curve.dto';

@Controller('analytics/features')
export class FeatureUsageController {
  private readonly logger = new Logger(FeatureUsageController.name);

  constructor(private readonly featureTrackerService: FeatureTrackerService) {}

  /**
   * POST /analytics/features/track
   * Track a single feature usage event.
   */
  @Post('track')
  async trackEvent(
    @Body() dto: TrackFeatureUsageDto,
  ): Promise<{ ok: boolean }> {
    await this.featureTrackerService.trackEvent(dto);
    return { ok: true };
  }

  /**
   * POST /analytics/features/track/bulk
   * Track multiple feature usage events in one request.
   */
  @Post('track/bulk')
  async trackBulk(
    @Body() dto: BulkTrackFeatureUsageDto,
  ): Promise<{ tracked: number }> {
    return this.featureTrackerService.trackBulk(dto);
  }

  /**
   * GET /analytics/features/metrics
   * Get detailed metrics for a specific feature.
   */
  @Get('metrics')
  async getFeatureMetrics(@Query() query: GetFeatureMetricsDto) {
    this.logger.log(`Feature metrics request: ${query.featureKey}`);
    return this.featureTrackerService.getFeatureMetrics(query);
  }

  /**
   * GET /analytics/features/ranking
   * Get features ranked by usage volume with trend indicators.
   */
  @Get('ranking')
  async getFeatureRanking(@Query() query: GetFeatureRankingDto) {
    return this.featureTrackerService.getFeatureRanking(query);
  }

  /**
   * GET /analytics/features/report
   * Get a full usage report across all features for a time period.
   */
  @Get('report')
  async getUsageReport(@Query() query: UsageReportQueryDto) {
    this.logger.log('Usage report requested');
    return this.featureTrackerService.getUsageReport(query);
  }

  /**
   * GET /analytics/features/user
   * Get feature usage breakdown for a specific user.
   */
  @Get('user')
  async getUserFeatureUsage(@Query() query: GetUserFeatureUsageDto) {
    return this.featureTrackerService.getUserFeatureUsage(query);
  }

  /**
   * GET /analytics/features/adoption-curve
   * Get time-series adoption curve data for a feature.
   */
  @Get('adoption-curve')
  async getAdoptionCurve(@Query() query: AdoptionCurveQueryDto) {
    return this.featureTrackerService.getAdoptionCurve(query);
  }
}
