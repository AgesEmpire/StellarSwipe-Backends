import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { IsEnum, IsISO8601, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { MetricPeriod } from './entities/metric-snapshot.entity';
import { UserEventType } from './entities/user-event.entity';
import { RiskMetricsService } from './services/risk-metrics.service';
import { RiskMetricsQueryDto } from './dto/risk-metrics.dto';

class TrackEventDto {
  @IsEnum(UserEventType)
  eventType!: UserEventType;

  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  eventId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly riskMetricsService: RiskMetricsService,
  ) {}

  @Post('events')
  async trackEvent(@Body() body: TrackEventDto) {
    const occurredAt = new Date(body.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestException('occurredAt must be a valid ISO date');
    }

    return this.analyticsService.trackEvent({
      eventType: body.eventType,
      occurredAt,
      userId: body.userId,
      sessionId: body.sessionId,
      eventId: body.eventId,
      metadata: body.metadata,
    });
  }

  @Get('dashboard')
  async getDashboard(@Query() query: AnalyticsQueryDto) {
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('startDate and endDate must be valid ISO dates');
    }

    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    const period = query.period ?? MetricPeriod.DAILY;
    const timezone = query.timezone ?? 'UTC';

    return this.analyticsService.getDashboardData({
      period,
      startDate,
      endDate,
      timezone,
    });
  }

  @Get('export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="analytics-export.csv"')
  async exportMetrics(@Query() query: AnalyticsQueryDto) {
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('startDate and endDate must be valid ISO dates');
    }

    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    const period = query.period ?? MetricPeriod.DAILY;
    const timezone = query.timezone ?? 'UTC';

    return this.analyticsService.exportMetrics({
      period,
      startDate,
      endDate,
      timezone,
    });
  }

  @Get('risk-metrics')
  async getRiskMetrics(@Req() req: any, @Query() query: RiskMetricsQueryDto) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('User authentication required');
    }

    return this.riskMetricsService.calculateRiskMetrics(userId, query.days);
  }
}
