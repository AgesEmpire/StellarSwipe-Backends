import { Controller, Get, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { QualityMetricsService } from './quality-metrics.service';
import { QualityReportDto } from './dto/quality-report.dto';

@Controller('code-quality')
export class QualityController {
  constructor(private readonly qualityMetricsService: QualityMetricsService) {}

  @Get('report')
  getLatestReport(): QualityReportDto | { message: string } {
    return this.qualityMetricsService.getLatestReport() ?? { message: 'No report available yet. Trigger a collection first.' };
  }

  @Post('collect')
  @HttpCode(HttpStatus.OK)
  async triggerCollection(): Promise<QualityReportDto> {
    return this.qualityMetricsService.collectAll();
  }
}
