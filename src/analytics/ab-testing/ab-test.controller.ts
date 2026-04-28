import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { AbTestAnalyzerService } from './ab-test-analyzer.service';
import { ExperimentAnalysisDto } from './dto/experiment-analysis.dto';

@Controller('analytics/ab-tests')
export class AbTestController {
  constructor(private readonly analyzer: AbTestAnalyzerService) {}

  @Post('analyze')
  analyze(@Body() dto: ExperimentAnalysisDto) {
    return this.analyzer.analyze(dto);
  }

  @Get(':experimentId')
  getResult(@Param('experimentId') experimentId: string) {
    return this.analyzer.getResult(experimentId);
  }
}
