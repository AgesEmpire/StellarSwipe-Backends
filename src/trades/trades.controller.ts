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
} from '@nestjs/common';
import { TradesService } from './trades.service';
import { RiskManagerService } from './services/risk-manager.service';
import { ExecuteTradeDto, CloseTradeDto } from './dto/execute-trade.dto';
import {
  TradeResultDto,
  TradeDetailsDto,
  TradeValidationResultDto,
  UserTradesSummaryDto,
  CloseTradeResultDto,
} from './dto/trade-result.dto';

@Controller('trades')
export class TradesController {
  constructor(
    private readonly tradesService: TradesService,
    private readonly riskManager: RiskManagerService,
  ) {}

  /**
   * Execute a new trade (swipe right action)
   * POST /trades/execute
   */
  @Post('execute')
  @HttpCode(HttpStatus.CREATED)
  async executeTrade(@Body() dto: ExecuteTradeDto): Promise<TradeResultDto> {
    return this.tradesService.executeTrade(dto);
  }

  /**
   * Validate trade before execution (preview)
   * POST /trades/validate
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validateTrade(@Body() dto: ExecuteTradeDto): Promise<TradeValidationResultDto> {
    return this.tradesService.validateTradePreview(dto);
  }

  /**
   * Close an open trade
   * POST /trades/close
   */
  @Post('close')
  @HttpCode(HttpStatus.OK)
  async closeTrade(@Body() dto: CloseTradeDto): Promise<CloseTradeResultDto> {
    return this.tradesService.closeTrade(dto);
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
   * Get user's trades with filtering
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
   * Get user's trading summary/statistics
   * GET /trades/user/:userId/summary
   */
  @Get('user/:userId/summary')
  async getUserTradesSummary(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserTradesSummaryDto> {
    return this.tradesService.getUserTradesSummary(userId);
  }

  /**
   * Get user's open positions
   * GET /trades/user/:userId/positions
   */
  @Get('user/:userId/positions')
  async getOpenPositions(
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<TradeDetailsDto[]> {
    return this.tradesService.getOpenPositions(userId);
  }

  /**
   * Get all trades for a specific signal
   * GET /trades/signal/:signalId
   */
  @Get('signal/:signalId')
  async getTradesBySignal(
    @Param('signalId', ParseUUIDPipe) signalId: string,
  ): Promise<TradeDetailsDto[]> {
    return this.tradesService.getTradesBySignal(signalId);
  }

  /**
   * Get current risk parameters
   * GET /trades/risk/parameters
   */
  @Get('risk/parameters')
  getRiskParameters() {
    return this.riskManager.getRiskParameters();
  }
}
