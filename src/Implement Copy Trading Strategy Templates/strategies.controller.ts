import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Request,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { StrategiesService, TradingSignal } from './strategies.service';
import { ApplyStrategyDto, CreateCustomTemplateDto } from './dto/apply-strategy.dto';
import { StrategyPerformanceDto } from './dto/strategy-performance.dto';

// Replace with your real Auth guard import
// import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@ApiTags('strategies')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard)
@Controller('strategies')
export class StrategiesController {
  constructor(private readonly strategiesService: StrategiesService) {}

  // ── GET /strategies/templates ─────────────────────────────────────────────
  @Get('templates')
  @ApiOperation({ summary: 'List all available strategy templates' })
  @ApiResponse({ status: 200, description: 'Returns built-in and user custom templates' })
  async listTemplates(@Request() req: any) {
    // Pass userId to include the user's custom templates
    const userId = req.user?.id;
    return this.strategiesService.listTemplates(userId);
  }

  // ── GET /strategies/templates/:id ─────────────────────────────────────────
  @Get('templates/:id')
  @ApiOperation({ summary: 'Get a specific template by ID' })
  async getTemplate(@Param('id') id: string) {
    return this.strategiesService.getTemplate(id);
  }

  // ── POST /strategies/templates (custom) ───────────────────────────────────
  @Post('templates')
  @ApiOperation({ summary: 'Create a custom strategy template' })
  @ApiResponse({ status: 201, description: 'Custom template created' })
  async createCustomTemplate(
    @Request() req: any,
    @Body() dto: CreateCustomTemplateDto,
  ) {
    const userId = req.user?.id ?? 'anonymous';
    return this.strategiesService.createCustomTemplate(userId, dto);
  }

  // ── POST /strategies/apply ────────────────────────────────────────────────
  @Post('apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Apply a strategy template to the authenticated user account',
  })
  @ApiResponse({ status: 200, description: 'Template applied successfully' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  @ApiResponse({ status: 400, description: 'Override conflicts with template parameters' })
  async applyTemplate(@Request() req: any, @Body() dto: ApplyStrategyDto) {
    const userId = req.user?.id ?? 'anonymous';
    return this.strategiesService.applyTemplate(userId, dto);
  }

  // ── POST /strategies/filter-signal ───────────────────────────────────────
  @Post('filter-signal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Filter a trading signal against the active strategy' })
  async filterSignal(@Request() req: any, @Body() signal: TradingSignal) {
    const userId = req.user?.id ?? 'anonymous';
    return this.strategiesService.filterSignal(userId, signal);
  }

  // ── GET /strategies/active-params ─────────────────────────────────────────
  @Get('active-params')
  @ApiOperation({ summary: 'Get effective risk parameters for active strategy' })
  async getEffectiveParams(@Request() req: any) {
    const userId = req.user?.id ?? 'anonymous';
    return this.strategiesService.getEffectiveParams(userId);
  }

  // ── GET /strategies/performance ───────────────────────────────────────────
  @Get('performance')
  @ApiOperation({ summary: 'Get performance metrics for the current active strategy' })
  @ApiResponse({ status: 200, type: StrategyPerformanceDto })
  async getPerformance(@Request() req: any): Promise<StrategyPerformanceDto> {
    const userId = req.user?.id ?? 'anonymous';
    return this.strategiesService.getPerformance(userId);
  }

  // ── GET /strategies/performance/history ───────────────────────────────────
  @Get('performance/history')
  @ApiOperation({ summary: 'Get performance history across all applied strategies' })
  @ApiResponse({ status: 200, type: [StrategyPerformanceDto] })
  async getPerformanceHistory(@Request() req: any): Promise<StrategyPerformanceDto[]> {
    const userId = req.user?.id ?? 'anonymous';
    return this.strategiesService.getPerformanceHistory(userId);
  }

  // ── POST /strategies/record-trade ─────────────────────────────────────────
  @Post('record-trade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record trade result for performance tracking' })
  async recordTradeResult(
    @Request() req: any,
    @Body() tradeResult: { pnl: number; profitable: boolean; drawdown?: number },
  ) {
    const userId = req.user?.id ?? 'anonymous';
    await this.strategiesService.recordTradeResult(userId, tradeResult);
    return { success: true };
  }
}
