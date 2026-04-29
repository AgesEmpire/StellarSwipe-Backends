import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  ParseIntPipe, DefaultValuePipe, BadRequestException, Request, UseGuards } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { RebalancingService } from './services/rebalancing.service';
import { PositionDetailDto } from './dto/position-detail.dto';
import { PortfolioSummaryDto } from './dto/portfolio-summary.dto';
import { SetTargetAllocationDto, TargetAllocationResponseDto } from './dto/target-allocation.dto';
import {
  DriftAnalysisDto,
  RebalancingPlanDto,
} from './dto/rebalancing-plan.dto';
import { Trade } from '../trades/entities/trade.entity';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ExportQueryDto } from './dto/export-query.dto';
import { ExportService } from './services/export.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AddTransactionDto } from './dto/add-transaction.dto';

@ApiTags('portfolio')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('portfolio')
export class PortfolioController {
  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly exportService: ExportService,
  ) { }

  @Get('positions')
  async getPositions(@Query('userId') userId: string): Promise<PositionDetailDto[]> {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    return this.portfolioService.getPositions(userId);
  }

  @Get('history')
  async getHistory(
    @Query('userId') userId: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<{ data: Trade[]; total: number; page: number; limit: number; totalPages: number }> {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    if (limit > 100) {
      throw new BadRequestException('limit cannot exceed 100');
    }

    const result = await this.portfolioService.getHistory(userId, page, limit);
    return {
      ...result,
      page,
      limit,
      totalPages: Math.ceil(result.total / limit),
    };
  }

  @Get('performance')
  async getPerformance(@Request() req: any): Promise<PortfolioSummaryDto> {
    return this.portfolioService.getPerformance(req.user.id);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export trade history as CSV or JSON' })
  @ApiResponse({ status: 200, description: 'Export initiated or completed' })
  async exportHistory(@Request() req: any, @Query() query: ExportQueryDto) {
    return this.exportService.exportTrades(req.user.id, query);
  }

  @Post('add-transaction')
  @ApiOperation({ summary: 'Record a new portfolio transaction' })
  @ApiResponse({ status: 201, description: 'Transaction recorded', type: Trade })
  async addTransaction(
    @Request() req: any,
    @Body() dto: AddTransactionDto,
  ): Promise<Trade> {
    return this.portfolioService.addTransaction(req.user.id, dto);
  }

  @Get('chart')
  @ApiOperation({ summary: 'Get historical portfolio PnL chart data' })
  @ApiResponse({ status: 200, description: 'Chart data points' })
  async getChartData(
    @Request() req: any,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    return this.portfolioService.getChartData(req.user.id, days);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Rebalancing – Target allocation management
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * POST /portfolio/rebalancing/target
   * Set or update the user's target allocation configuration.
   *
   * Body example:
   * {
   *   "allocations": [
   *     { "assetCode": "USDC", "targetPercentage": 50 },
   *     { "assetCode": "XLM",  "targetPercentage": 30 },
   *     { "assetCode": "AQUA", "targetPercentage": 20 }
   *   ],
   *   "driftThresholdPercent": 5,
   *   "autoRebalance": false
   * }
   */
  @Post('rebalancing/target')
  setTargetAllocation(
    @Query('userId') userId: string,
    @Body() dto: SetTargetAllocationDto,
  ): TargetAllocationResponseDto {
    return this.rebalancingService.setTargetAllocation(userId, dto);
  }

  /**
   * GET /portfolio/rebalancing/target
   * Retrieve the stored target allocation for a user.
   */
  @Get('rebalancing/target')
  getTargetAllocation(
    @Query('userId') userId: string,
  ): TargetAllocationResponseDto {
    return this.rebalancingService.getTargetAllocation(userId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Rebalancing – Drift detection
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * GET /portfolio/rebalancing/drift
   * Analyse current portfolio drift against target allocations.
   * Returns per-asset drift percentages and whether rebalancing is required.
   */
  @Get('rebalancing/drift')
  async analyzeDrift(
    @Query('userId') userId: string,
  ): Promise<DriftAnalysisDto> {
    return this.rebalancingService.analyzeDrift(userId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Rebalancing – Plan generation & execution
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * POST /portfolio/rebalancing/plan
   * Generate a rebalancing plan. If autoExecute=true (or user's autoRebalance
   * flag is set), trades are executed immediately. Otherwise the plan is saved
   * pending manual approval.
   */
  @Post('rebalancing/plan')
  async createPlan(
    @Query('userId') userId: string,
    @Query('autoExecute') autoExecute?: string,
  ): Promise<RebalancingPlanDto> {
    return this.rebalancingService.createRebalancingPlan(
      userId,
      autoExecute === 'true',
    );
  }

  /**
   * GET /portfolio/rebalancing/plans/pending
   * List all pending rebalancing plans awaiting approval.
   */
  @Get('rebalancing/plans/pending')
  getPendingPlans(
    @Query('userId') userId: string,
  ): RebalancingPlanDto[] {
    return this.rebalancingService.getPendingPlans(userId);
  }

  /**
   * PUT /portfolio/rebalancing/plans/:planId/approve
   * Approve and execute a specific pending rebalancing plan.
   */
  @Put('rebalancing/plans/:planId/approve')
  async approvePlan(
    @Query('userId') userId: string,
    @Param('planId') planId: string,
  ): Promise<RebalancingPlanDto> {
    return this.rebalancingService.approvePlan(userId, planId);
  }
}
