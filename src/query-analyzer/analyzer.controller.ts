import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { QueryAnalyzerService } from './query-analyzer.service';
import {
  SubmitQueryAnalysisDto,
  BulkQueryIngestionDto,
  QueryFilterDto,
  MarkOptimizationAppliedDto,
  QueryAnalysisResultDto,
} from './dto/query-analysis.dto';
import { OptimizationFilterDto } from './dto/optimization-suggestion.dto';

@ApiTags('Database Query Analyzer')
@Controller('db/analyzer')
export class AnalyzerController {
  constructor(private readonly analyzerService: QueryAnalyzerService) {}

  // ─── Submit ────────────────────────────────────────────────────────────────

  @Post('submit')
  @ApiOperation({
    summary: 'Submit a slow query for analysis',
    description:
      'Enqueues the query for async EXPLAIN-based analysis. Returns immediately with the created record.',
  })
  @ApiResponse({ status: 202, description: 'Query accepted for analysis' })
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(@Body() dto: SubmitQueryAnalysisDto) {
    return this.analyzerService.submitQuery(dto);
  }

  @Post('submit/bulk')
  @ApiOperation({
    summary: 'Submit multiple slow queries for analysis in one call',
  })
  @HttpCode(HttpStatus.ACCEPTED)
  async submitBulk(@Body() dto: BulkQueryIngestionDto) {
    return this.analyzerService.submitBulk(dto);
  }

  // ─── Queries ───────────────────────────────────────────────────────────────

  @Get('queries')
  @ApiOperation({ summary: 'List captured slow queries with filters' })
  @ApiResponse({ status: 200, type: QueryAnalysisResultDto, isArray: true })
  async listQueries(@Query() filter: QueryFilterDto) {
    return this.analyzerService.listSlowQueries(filter);
  }

  @Get('queries/:id')
  @ApiOperation({ summary: 'Get a single slow query with all its optimizations' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async getQuery(@Param('id', ParseUUIDPipe) id: string) {
    return this.analyzerService.getSlowQuery(id);
  }

  @Post('queries/:id/reanalyze')
  @ApiOperation({ summary: 'Re-run analysis on an existing slow query record' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @HttpCode(HttpStatus.ACCEPTED)
  async reanalyze(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('runExplainAnalyze') runExplainAnalyze?: boolean,
  ) {
    await this.analyzerService.analyzeQuery(id, runExplainAnalyze ?? false);
    return { message: 'Re-analysis enqueued', id };
  }

  // ─── Index Report ──────────────────────────────────────────────────────────

  @Get('queries/:id/index-report')
  @ApiOperation({
    summary: 'Get a detailed index recommendation report for a specific slow query',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async getIndexReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.analyzerService.getIndexReport(id);
  }

  // ─── Optimizations ─────────────────────────────────────────────────────────

  @Get('optimizations')
  @ApiOperation({ summary: 'List all optimization suggestions with optional filters' })
  async listOptimizations(@Query() filter: OptimizationFilterDto) {
    return this.analyzerService.listOptimizations(filter);
  }

  @Patch('optimizations/apply')
  @ApiOperation({ summary: 'Mark an optimization as applied and record verified improvement' })
  async markApplied(@Body() dto: MarkOptimizationAppliedDto) {
    return this.analyzerService.markOptimizationApplied(dto);
  }

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  @Get('dashboard')
  @ApiOperation({ summary: 'Get aggregated stats for the analyzer dashboard' })
  async dashboard() {
    return this.analyzerService.getDashboardStats();
  }
}
