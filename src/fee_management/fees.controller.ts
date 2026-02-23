import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { FeesService } from './fees.service';
import { FeeManagerService } from './fee-manager.service';
import { FeeCalculatorService } from './fee-calculator.service';
import {
  FeeSummaryDto,
  UserFeeSummaryDto,
  FeeCalculationDto,
  GetFeeHistoryDto,
  FeeConfigDto,
  MonthlyRevenueReportDto,
} from './dto/fee-summary.dto';
import {
  CreateFeeTierDto,
  UpdateFeeTierDto,
  FeeTierResponseDto,
  CreatePromotionDto,
  UpdatePromotionDto,
  PromotionResponseDto,
  CheckEligibilityDto,
  CheckEligibilityResponseDto,
  RevenueForecastDto,
  TierVolumeStatsDto,
} from './dto/fee-tier.dto';
import { FeeTransaction } from './entities/fee-transaction.entity';
import { FeeTierType } from './entities/fee-tier.entity';
import { PromotionStatus } from './entities/fee-promotion.entity';

// Mock auth guards - replace with your actual auth guards
class JwtAuthGuard {}
class AdminGuard {}

@ApiTags('Fees')
@Controller('fees')
export class FeesController {
  constructor(
    private readonly feesService: FeesService,
    private readonly feeManager: FeeManagerService,
    private readonly feeCalculator: FeeCalculatorService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // Basic Fee Operations (Existing)
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('config')
  @ApiOperation({ summary: 'Get current fee configuration' })
  @ApiResponse({
    status: 200,
    description: 'Fee configuration retrieved successfully',
    type: FeeConfigDto,
  })
  getFeeConfig(): FeeConfigDto {
    return this.feesService.getFeeConfig();
  }

  @Post('calculate')
  @ApiOperation({ summary: 'Calculate fee for a trade' })
  @ApiResponse({
    status: 200,
    description: 'Fee calculated successfully',
    type: FeeCalculationDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid trade details' })
  async calculateFee(
    @Body()
    tradeDetails: {
      userId: string;
      tradeId: string;
      tradeAmount: string;
      assetCode: string;
      assetIssuer: string;
    },
  ): Promise<FeeCalculationDto> {
    return this.feesService.calculateFee(tradeDetails);
  }

  @Post('calculate-dynamic')
  @ApiOperation({
    summary: 'Calculate fee with dynamic tier and promotion support',
  })
  @ApiResponse({
    status: 200,
    description: 'Fee calculated successfully',
  })
  async calculateFeeDynamic(
    @Body()
    params: {
      userId: string;
      tradeId?: string;
      tradeAmount: string;
      assetCode: string;
      assetIssuer?: string;
      promoCode?: string;
      userMonthlyVolume?: string;
      userTradeCount?: number;
      isVip?: boolean;
    },
  ) {
    return this.feeCalculator.calculateFee(params, {
      promoCode: params.promoCode,
      userMonthlyVolume: params.userMonthlyVolume,
      userTradeCount: params.userTradeCount,
      isVip: params.isVip,
    });
  }

  @Post('collect')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate and collect fee on trade execution' })
  @ApiResponse({
    status: 200,
    description: 'Fee collected successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid trade details' })
  @ApiResponse({ status: 500, description: 'Fee collection failed' })
  async collectFee(
    @Body()
    tradeDetails: {
      userId: string;
      tradeId: string;
      tradeAmount: string;
      assetCode: string;
      assetIssuer: string;
      userPublicKey?: string;
    },
  ): Promise<{
    success: boolean;
    feeTransaction: FeeTransaction;
    transactionHash?: string;
    error?: string;
  }> {
    return this.feesService.calculateAndCollectFee(tradeDetails);
  }

  @Post('collect-dynamic')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calculate and collect fee with dynamic tier/promotion',
  })
  async collectFeeDynamic(
    @Body()
    params: {
      userId: string;
      tradeId: string;
      tradeAmount: string;
      assetCode: string;
      assetIssuer?: string;
      userPublicKey?: string;
      promoCode?: string;
      userMonthlyVolume?: string;
      userTradeCount?: number;
      isVip?: boolean;
    },
  ) {
    return this.feeCalculator.calculateAndCollectFee(
      {
        userId: params.userId,
        tradeId: params.tradeId,
        tradeAmount: params.tradeAmount,
        assetCode: params.assetCode,
        assetIssuer: params.assetIssuer,
        userPublicKey: params.userPublicKey,
      },
      {
        promoCode: params.promoCode,
        userMonthlyVolume: params.userMonthlyVolume,
        userTradeCount: params.userTradeCount,
        isVip: params.isVip,
      },
    );
  }

  @Get('history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get fee transaction history with filtering' })
  @ApiResponse({
    status: 200,
    description: 'Fee history retrieved successfully',
  })
  async getFeeHistory(
    @Query() filters: GetFeeHistoryDto,
  ): Promise<{ data: FeeTransaction[]; total: number }> {
    return this.feesService.getFeeHistory(filters);
  }

  @Get('user/:userId/summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get fee summary for a specific user' })
  @ApiResponse({
    status: 200,
    description: 'User fee summary retrieved successfully',
    type: UserFeeSummaryDto,
  })
  async getUserFeeSummary(
    @Param('userId') userId: string,
  ): Promise<UserFeeSummaryDto> {
    return this.feesService.getUserFeeSummary(userId);
  }

  @Get('platform/summary')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get platform fee summary for a period' })
  @ApiQuery({ name: 'startDate', required: true, type: String })
  @ApiQuery({ name: 'endDate', required: true, type: String })
  @ApiResponse({
    status: 200,
    description: 'Platform summary retrieved successfully',
    type: FeeSummaryDto,
  })
  async getPlatformSummary(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ): Promise<FeeSummaryDto> {
    return this.feesService.getPlatformFeeSummary(
      new Date(startDate),
      new Date(endDate),
    );
  }

  @Get('reports/monthly/:year/:month')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate monthly revenue report' })
  @ApiResponse({
    status: 200,
    description: 'Monthly report generated successfully',
    type: MonthlyRevenueReportDto,
  })
  async getMonthlyReport(
    @Param('year') year: number,
    @Param('month') month: number,
  ): Promise<MonthlyRevenueReportDto> {
    return this.feesService.generateMonthlyReport(+year, +month);
  }

  @Post('retry-failed')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry failed fee collections' })
  @ApiResponse({
    status: 200,
    description: 'Retry process completed',
  })
  async retryFailedCollections(): Promise<{
    attempted: number;
    succeeded: number;
    failed: number;
  }> {
    return this.feesService.retryFailedCollections();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Fee Tier Management
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('tiers')
  @ApiOperation({ summary: 'Get all fee tiers' })
  @ApiResponse({
    status: 200,
    description: 'Fee tiers retrieved successfully',
    type: [FeeTierResponseDto],
  })
  async getAllFeeTiers() {
    return this.feeManager.getAllFeeTiers();
  }

  @Get('tiers/:tierType')
  @ApiOperation({ summary: 'Get a specific fee tier' })
  @ApiResponse({
    status: 200,
    description: 'Fee tier retrieved successfully',
    type: FeeTierResponseDto,
  })
  async getFeeTier(@Param('tierType') tierType: FeeTierType) {
    return this.feeManager.getFeeTier(tierType);
  }

  @Post('tiers')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new fee tier' })
  @ApiResponse({
    status: 201,
    description: 'Fee tier created successfully',
    type: FeeTierResponseDto,
  })
  async createFeeTier(@Body() dto: CreateFeeTierDto) {
    return this.feeManager.createFeeTier(dto as any);
  }

  @Patch('tiers/:tierType')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a fee tier' })
  @ApiResponse({
    status: 200,
    description: 'Fee tier updated successfully',
    type: FeeTierResponseDto,
  })
  async updateFeeTier(
    @Param('tierType') tierType: FeeTierType,
    @Body() dto: UpdateFeeTierDto,
  ) {
    return this.feeManager.updateFeeTier(tierType, dto as any);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Promotion Management
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('promotions')
  @ApiOperation({ summary: 'Get all promotions' })
  @ApiResponse({
    status: 200,
    description: 'Promotions retrieved successfully',
    type: [PromotionResponseDto],
  })
  async getAllPromotions(@Query('status') status?: PromotionStatus) {
    return this.feeManager.getAllPromotions(status);
  }

  @Get('promotions/active')
  @ApiOperation({ summary: 'Get currently active promotions' })
  @ApiResponse({
    status: 200,
    description: 'Active promotions retrieved successfully',
    type: [PromotionResponseDto],
  })
  async getActivePromotions() {
    return this.feeManager.getActivePromotions();
  }

  @Get('promotions/:id')
  @ApiOperation({ summary: 'Get a specific promotion' })
  @ApiResponse({
    status: 200,
    description: 'Promotion retrieved successfully',
    type: PromotionResponseDto,
  })
  async getPromotion(@Param('id', ParseUUIDPipe) id: string) {
    return this.feeManager.getPromotion(id);
  }

  @Post('promotions')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new promotion' })
  @ApiResponse({
    status: 201,
    description: 'Promotion created successfully',
    type: PromotionResponseDto,
  })
  async createPromotion(@Body() dto: CreatePromotionDto) {
    return this.feeManager.createPromotion(dto as any);
  }

  @Patch('promotions/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a promotion' })
  @ApiResponse({
    status: 200,
    description: 'Promotion updated successfully',
    type: PromotionResponseDto,
  })
  async updatePromotion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromotionDto,
  ) {
    return this.feeManager.updatePromotion(id, dto as any);
  }

  @Delete('promotions/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a promotion' })
  @ApiResponse({
    status: 200,
    description: 'Promotion cancelled successfully',
  })
  async cancelPromotion(@Param('id', ParseUUIDPipe) id: string) {
    return this.feeManager.cancelPromotion(id);
  }

  @Post('promotions/check-eligibility')
  @ApiOperation({ summary: 'Check if user is eligible for a promotion' })
  @ApiResponse({
    status: 200,
    description: 'Eligibility check result',
  })
  async checkEligibility(@Body() dto: CheckEligibilityDto) {
    const result = await this.feeManager.checkPromotionEligibility(
      dto.promoCode,
      dto.userId,
      dto.tradeAmount,
      dto.assetCode,
    );
    return result;
  }

  @Get('promotions/:id/stats')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get promotion statistics' })
  @ApiResponse({
    status: 200,
    description: 'Promotion statistics retrieved',
  })
  async getPromotionStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.feeManager.getPromotionStats(id);
  }

  @Get('user/:userId/redemptions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user promotion redemptions' })
  @ApiResponse({
    status: 200,
    description: 'User redemptions retrieved',
  })
  async getUserRedemptions(@Param('userId') userId: string) {
    return this.feeManager.getUserRedemptions(userId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Fee Schedule & Revenue Forecasting
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('schedule')
  @ApiOperation({ summary: 'Get current fee schedule' })
  @ApiResponse({
    status: 200,
    description: 'Fee schedule retrieved successfully',
  })
  async getFeeSchedule() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const tiers = await this.feeManager.getAllFeeTiers();
    const activePromotions = await this.feeManager.getActivePromotions();

    return {
      periodStart: startOfMonth.toISOString(),
      periodEnd: endOfMonth.toISOString(),
      tiers,
      activePromotions,
    };
  }

  @Post('forecast')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate revenue forecast' })
  @ApiResponse({
    status: 200,
    description: 'Revenue forecast generated',
  })
  async generateForecast(
    @Body()
    params: {
      startDate: string;
      endDate: string;
      includePromotions?: boolean;
      growthRate?: number;
    },
  ) {
    return this.feeCalculator.generateRevenueForecast(
      new Date(params.startDate),
      new Date(params.endDate),
      {
        includePromotions: params.includePromotions,
        growthRate: params.growthRate,
      },
    );
  }

  @Get('tier-stats')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get volume statistics by tier' })
  @ApiQuery({ name: 'startDate', required: true, type: String })
  @ApiQuery({ name: 'endDate', required: true, type: String })
  @ApiResponse({
    status: 200,
    description: 'Tier statistics retrieved',
  })
  async getTierVolumeStats(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.feeCalculator.getTierVolumeStats(
      new Date(startDate),
      new Date(endDate),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Maintenance
  // ═══════════════════════════════════════════════════════════════════════════

  @Post('maintenance/update-promotion-statuses')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update promotion statuses based on dates (scheduled job)',
  })
  @ApiResponse({
    status: 200,
    description: 'Promotion statuses updated',
  })
  async updatePromotionStatuses() {
    return this.feeManager.updatePromotionStatuses();
  }
}
