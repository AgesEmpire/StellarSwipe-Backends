import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { PatternAnalyzerService } from './pattern-analyzer.service';
import { PatternAnalysisDto } from './dto/pattern-analysis.dto';

@Controller('analytics/trade-patterns')
export class PatternController {
  constructor(
    private readonly patternAnalyzerService: PatternAnalyzerService,
  ) {}

  @Post('analyze')
  analyze(@Body() dto: PatternAnalysisDto) {
    return this.patternAnalyzerService.analyze(dto);
  }

  @Get(':userId/patterns')
  getPatterns(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.patternAnalyzerService.getPatterns(userId);
  }

  @Get(':userId/insights')
  getInsights(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.patternAnalyzerService.getInsights(userId);
  }
}
