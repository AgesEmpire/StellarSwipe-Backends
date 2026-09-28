import { Controller, Get, Query } from '@nestjs/common';
import { CohortAnalyzerService } from './cohort-analyzer.service';
import { CohortQueryDto } from './dto/cohort-query.dto';

@Controller('analytics/cohorts')
export class CohortController {
  constructor(private readonly cohortAnalyzerService: CohortAnalyzerService) {}

  @Get('analyze')
  analyze(@Query() query: CohortQueryDto) {
    return this.cohortAnalyzerService.analyze(query);
  }

  @Get('retention-matrix')
  getRetentionMatrix(@Query() query: CohortQueryDto) {
    return this.cohortAnalyzerService.getRetentionMatrix(query);
  }
}
