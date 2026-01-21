import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { FeesService } from './fee.service';
import {
  FeeSummaryDto,
  UserFeeSummaryDto,
  FeeCalculationDto,
  GetFeeHistoryDto,
  FeeConfigDto,
  MonthlyRevenueReportDto,
} from './dto/fee-summary.dto';
import { FeeTransaction } from './entities/fee-transaction.entity';

// Mock auth guard - replace with your actual auth guard
class JwtAuthGuard {}
class AdminGuard {}

@ApiTags('Fees')
@Controller('fees')
export class FeesController {
  constructor(private readonly feesService: FeesService) {}

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

  @Post('promotion/apply')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply promotional fee rate to user' })
  @ApiResponse({
    status: 200,
    description: 'Promotional rate applied successfully',
  })
  async applyPromotionalRate(
    @Body()
    body: {
      userId: string;
      promotionCode: string;
      customRate: string;
    },
  ): Promise<{ message: string }> {
    await this.feesService.applyPromotionalRate(
      body.userId,
      body.promotionCode,
      body.customRate,
    );
    return { message: 'Promotional rate applied successfully' };
  }
}