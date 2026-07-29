import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseBoolPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { TradesService } from './trades.service';
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

@Controller('trades')
export class TradesController {
  constructor(
    private readonly tradesService: TradesService,
    private readonly riskManager: RiskManagerService,
    private readonly partialCloseService: PartialCloseService,
  ) { }

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
   * Partially close an open position
   * POST /trades/partial-close
   */
  @Post('partial-close')
  @HttpCode(HttpStatus.OK)
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
    @Query('includeDeleted', new DefaultValuePipe(false), ParseBoolPipe) includeDeleted: boolean,
  ): Promise<TradeDetailsDto> {
    return this.tradesService.getTradeById(tradeId, userId, includeDeleted);
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
    @Query('includeDeleted', new DefaultValuePipe(false), ParseBoolPipe) includeDeleted?: boolean,
  ): Promise<TradeDetailsDto[]> {
    return this.tradesService.getUserTrades({
      userId,
      status,
      limit,
      offset,
      includeDeleted,
    });
  }

  /**
   * Soft-delete a trade (recoverable)
   * DELETE /trades/:tradeId
   */
  @Delete(':tradeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async softDeleteTrade(
    @Param('tradeId', ParseUUIDPipe) tradeId: string,
    @Query('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.tradesService.softDeleteTrade(tradeId, userId);
  }

  /**
   * Restore a soft-deleted trade
   * POST /trades/:tradeId/restore
   */
  @Post(':tradeId/restore')
  @HttpCode(HttpStatus.OK)
  async restoreTrade(
    @Param('tradeId', ParseUUIDPipe) tradeId: string,
    @Query('userId', ParseUUIDPipe) userId: string,
  ): Promise<TradeDetailsDto> {
    return this.tradesService.restoreTrade(tradeId, userId);
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
