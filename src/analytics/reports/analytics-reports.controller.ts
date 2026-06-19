import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AnalyticsReportsService } from './analytics-reports.service';
import { AnalyticsQueryDto } from '../dto/analytics-query.dto';
import { MetricPeriod } from '../entities/metric-snapshot.entity';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics/reports')
export class AnalyticsReportsController {
  constructor(private readonly analyticsReportsService: AnalyticsReportsService) {}

  /**
   * POST /analytics/reports
   * Queue a CSV analytics export instead of generating it on the request
   * thread. Returns immediately with a job id — poll GET /analytics/reports/:jobId.
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Queue an analytics CSV export job' })
  async queueExport(@Body() query: AnalyticsQueryDto): Promise<{ jobId: string }> {
    const startDate = new Date(query.startDate);
    const endDate = new Date(query.endDate);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new BadRequestException('startDate and endDate must be valid ISO dates');
    }

    if (startDate >= endDate) {
      throw new BadRequestException('startDate must be before endDate');
    }

    return this.analyticsReportsService.enqueueExport({
      period: query.period ?? MetricPeriod.DAILY,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      timezone: query.timezone ?? 'UTC',
    });
  }

  /**
   * GET /analytics/reports/:jobId
   * Status of a queued export job. `result` (the CSV body) is present once
   * `state` is `completed`.
   */
  @Get(':jobId')
  @ApiOperation({ summary: 'Get the status (and result) of a queued analytics export job' })
  async getStatus(@Param('jobId') jobId: string) {
    return this.analyticsReportsService.getJobStatus(jobId);
  }
}
