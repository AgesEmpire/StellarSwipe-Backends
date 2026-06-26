import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseGuards,
  UseInterceptors,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { RateLimit, RateLimitTier } from '../common/decorators/rate-limit.decorator';
import { TradesService } from './trades.service';
import { TradeOutcomeService } from './trade-outcome.service';
import { TradeOutcomeQueryDto } from './dto/trade-outcome-query.dto';
import { TradeHistoryService } from './trade-history.service';
import { RiskManagerService } from './services/risk-manager.service';
import { ExecuteTradeDto, CloseTradeDto } from './dto/execute-trade.dto';
import { PartialCloseDto } from './partial-close/dto/partial-close.dto';
import { PartialCloseService } from './partial-close/partial-close.service';
import {
  TradeResultDto,
  TradeDetailsDto,
  TradeValidationResultDto,
  UserTradesSummaryDto,
  CloseTradeResultDto,
} from './dto/trade-result.dto';
import { PaginatedTradeHistoryDto } from './trade-history.service';

@Controller('trades')
@UseInterceptors(IdempotencyInterceptor)
export class TradesController {
  constructor(
    private readonly tradesService: TradesService,
    private readonly tradeHistoryService: TradeHistoryService,
    private readonly riskManager: RiskManagerService,
    private readonly partialCloseService: PartialCloseService,
    private readonly tradeOutcomeService: TradeOutcomeService,
  ) { }

  /**
   * Execute a new trade (swipe right action)
   * POST /trades/execute
   */
  @Post('execute')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ tier: RateLimitTier.TRADE })
  async executeTrade(@Body() dto: ExecuteTradeDto): Promise<TradeResultDto> {
    return this.tradesService.executeTrade(dto);
  }

  /**
   * Validate trade before execution (preview)
   * POST /trades/validate
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ tier: RateLimitTier.TRADE })
  async validateTrade(@Body() dto: ExecuteTradeDto): Promise<TradeValidationResultDto> {
    return this.tradesService.validateTradePreview(dto);
  }

  /**
   * Close an open trade
   * POST /trades/close
   */
  @Post('close')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ tier: RateLimitTier.TRADE })
  async closeTrade(@Body() dto: CloseTradeDto): Promise<CloseTradeResultDto> {
    return this.tradesService.closeTrade(dto);
  }

  /**
   * Partially close an open position
   * POST /trades/partial-close
   */
  @Post('partial-close')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ tier: RateLimitTier.TRADE })
  async partialClose(@Body() dto: PartialCloseDto): Promise<any> {
    return this.partialCloseService.closePartial(dto);
  }

  /**
   * Get trade by ID
   * GET /trades/:tradeId
   */
  @Get(':tradeId')
  async getTradeById(
    @Param('tradeId', ParseUUIDPipe) tradeId: string,
    @Query('userId', ParseUUIDPipe) userId: string,
  ): Promise<TradeDetailsDto> {
    return this.tradesService.getTradeById(tradeId, userId);
  }

  /**
   * Get user's trade history with optional filtering and pagination.
   * Supports status, date-range (startDate/endDate), limit, and offset.
   * GET /trades/user/:userId/history
   */
  @Get('user/:userId/history')
  async getUserTradeHistory(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<PaginatedTradeHistoryDto> {
    return this.tradeHistoryService.getUserTradeHistory({
      userId,
      status,
      startDate,
      endDate,
      limit,
      offset,
    });
  }

  /**
   * Get user's trades with filtering (legacy – prefer /history for new clients)
   * GET /trades/user/:userId
   */
  @Get('user/:userId')
  async getUserTrades(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<TradeDetailsDto[]> {
    return this.tradesService.getUserTrades({
      userId,
      status,
      limit,
      offset,
    });
  }

  /**
   * Get user's trading summary/statistics (DB-aggregated)
   * GET /trades/user/:userId/summary
   */
  @Get('user/:userId/summary')
  async getUserTradesSummary(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserTradesSummaryDto> {
    return this.tradeHistoryService.getUserTradesSummary(userId);
  }

  /**
   * Get user's open positions (DB-filtered)
   * GET /trades/user/:userId/positions
   */
  @Get('user/:userId/positions')
  async getOpenPositions(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<TradeDetailsDto[]> {
    return this.tradeHistoryService.getOpenPositions(userId);
  }

  /**
   * Get all trades for a specific signal
   * GET /trades/signal/:signalId
   */
  @Get('signal/:signalId')
  async getTradesBySignal(
    @Param('signalId', ParseUUIDPipe) signalId: string,
  ): Promise<TradeDetailsDto[]> {
    return this.tradeHistoryService.getTradesBySignal(signalId);
  }

  /**
   * Get current risk parameters
   * GET /trades/risk/parameters
   */
  @Get('risk/parameters')
  getRiskParameters() {
    return this.riskManager.getRiskParameters();
  }

  /**
   * Get final outcome for a single trade (polling endpoint)
   * GET /trades/:tradeId/outcome
   */
  @Get(':tradeId/outcome')
  @UseGuards(JwtAuthGuard)
  getOutcome(
    @Param('tradeId', ParseUUIDPipe) tradeId: string,
    @Request() req: any,
  ) {
    return this.tradeOutcomeService.getOutcome(tradeId, req.user.id);
  }

  /**
   * Query trade outcomes by user / transactionId / status
   * GET /trades/outcomes
   */
  @Get('outcomes')
  @UseGuards(JwtAuthGuard)
  queryOutcomes(@Query() query: TradeOutcomeQueryDto, @Request() req: any) {
    return this.tradeOutcomeService.queryOutcomes(query, req.user.id);
  }
}
