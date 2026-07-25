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
  Res,
  Header,
} from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { buildPaginationLinks } from '../common/pagination/pagination-links.util';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OwnershipGuard } from '../common/guards/ownership.guard';
import { MaxCallDepthGuard } from '../common/guards/max-call-depth.guard';
import { RequireIdempotencyKeyGuard } from '../common/guards/require-idempotency-key.guard';
import { CheckOwnership } from '../common/decorators/check-ownership.decorator';
import { Trade } from './entities/trade.entity';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import {
  RateLimit,
  RateLimitTier,
} from '../common/decorators/rate-limit.decorator';
import { MaxCallDepth } from '../common/decorators/max-call-depth.decorator';
import { RequireScopes } from '../api-keys/decorators/require-scopes.decorator';
import { ApiKeyScope } from '../api-keys/enums/api-key-scope.enum';
import {
  ExecuteTradeCommand,
  CancelTradeCommand,
  GetTradeStatusQuery,
} from './cqrs';
import { TradesService } from './trades.service';
import { TradeOutcomeService } from './trade-outcome.service';
import { TradeOutcomeQueryDto } from './dto/trade-outcome-query.dto';
import { TradeHistoryService } from './trade-history.service';
import { RiskManagerService } from './services/risk-manager.service';
import { ExecuteTradeDto, CloseTradeDto } from './dto/execute-trade.dto';
import { PartialCloseDto } from './partial-close/dto/partial-close.dto';
import { PartialCloseService } from './partial-close/partial-close.service';
import { TradeCsvExportService } from './trade-csv-export.service';
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
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  /**
   * Execute a new trade (swipe right action)
   * POST /trades/execute
   *
   * Requires Idempotency-Key header to prevent duplicate trade execution.
   * Returns 400 when the header is absent, 409 when a concurrent duplicate arrives.
   * Requires trades:write scope for API key authenticated requests.
   *
   * Issue #861 — mandatory idempotency key
   * Issue #860 — scope validation
   */
  @Post('execute')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ tier: RateLimitTier.TRADE })
  @UseGuards(MaxCallDepthGuard, RequireIdempotencyKeyGuard)
  @MaxCallDepth({
    maxDepth: 5,
    endpoint: 'execute-trade',
    onViolation: 'reject',
  })
  @RequireScopes(ApiKeyScope.TRADES_WRITE)
  @ApiResponse({ status: 201, description: 'Trade execution started' })
  @ApiResponse({ status: 400, description: 'Missing Idempotency-Key header' })
  @ApiResponse({
    status: 403,
    description: 'API key missing trades:write scope',
  })
  @ApiResponse({ status: 409, description: 'Concurrent duplicate request' })
  @ApiResponse({ status: 422, description: 'Slippage tolerance exceeded' })
  async executeTrade(@Body() dto: ExecuteTradeDto): Promise<TradeResultDto> {
    return this.commandBus.execute(new ExecuteTradeCommand(dto));
  }

  /**
   * Validate trade before execution (preview)
   * POST /trades/validate
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ tier: RateLimitTier.TRADE })
  @RequireScopes(ApiKeyScope.TRADES_WRITE)
  async validateTrade(
    @Body() dto: ExecuteTradeDto,
  ): Promise<TradeValidationResultDto> {
    return this.tradesService.validateTradePreview(dto);
  }

  /**
   * Close an open trade
   * POST /trades/close
   */
  @Post('close')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ tier: RateLimitTier.TRADE })
  @UseGuards(MaxCallDepthGuard)
  @MaxCallDepth({ maxDepth: 3, endpoint: 'close-trade', onViolation: 'reject' })
  @RequireScopes(ApiKeyScope.TRADES_WRITE)
  async closeTrade(@Body() dto: CloseTradeDto): Promise<CloseTradeResultDto> {
    return this.commandBus.execute(new CancelTradeCommand(dto));
  }

  /**
   * Partially close an open position
   * POST /trades/partial-close
   */
  @Post('partial-close')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ tier: RateLimitTier.TRADE })
  @RequireScopes(ApiKeyScope.TRADES_WRITE)
  async partialClose(@Body() dto: PartialCloseDto): Promise<any> {
    return this.partialCloseService.closePartial(dto);
  }

  /**
   * Get trade by ID
   * GET /trades/:tradeId
   */
  @Get(':tradeId')
  @UseGuards(JwtAuthGuard, OwnershipGuard)
  @CheckOwnership('tradeId', Trade)
  @RequireScopes(ApiKeyScope.TRADES_READ)
  async getTradeById(
    @Param('tradeId', ParseUUIDPipe) tradeId: string,
    @Request() req: any,
  ): Promise<TradeDetailsDto> {
    return this.queryBus.execute(new GetTradeStatusQuery(tradeId, req.user.id));
  }

  /**
   * Get user's trade history with optional filtering and pagination.
   * Supports status, date-range (startDate/endDate), limit, and offset.
   * GET /trades/user/:userId/history
   */
  @Get('user/:userId/history')
  @RequireScopes(ApiKeyScope.TRADES_READ)
  async getUserTradeHistory(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('status') status?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Request() req?: any,
  ): Promise<
    PaginatedTradeHistoryDto & {
      links?: ReturnType<typeof buildPaginationLinks>;
    }
  > {
    const resolvedLimit = Number(limit) || 20;
    const resolvedOffset = Number(offset) || 0;

    const result = await this.tradeHistoryService.getUserTradeHistory({
      userId,
      status,
      startDate,
      endDate,
      limit: resolvedLimit,
      offset: resolvedOffset,
    });

    const totalPages = Math.ceil(result.total / resolvedLimit);
    const currentPage = Math.floor(resolvedOffset / resolvedLimit) + 1;

    const links = req
      ? buildPaginationLinks(req.url, {
          page: currentPage,
          limit: resolvedLimit,
          totalPages,
        })
      : undefined;

    return { ...result, links };
  }

  /**
   * Get user's trades with filtering (legacy – prefer /history for new clients)
   * GET /trades/user/:userId
   */
  @Get('user/:userId')
  @RequireScopes(ApiKeyScope.TRADES_READ)
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
  @RequireScopes(ApiKeyScope.TRADES_READ)
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
  @RequireScopes(ApiKeyScope.TRADES_READ)
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
  @RequireScopes(ApiKeyScope.TRADES_READ)
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
  @UseGuards(JwtAuthGuard, OwnershipGuard)
  @CheckOwnership('tradeId', Trade)
  @RequireScopes(ApiKeyScope.TRADES_READ)
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
  @RequireScopes(ApiKeyScope.TRADES_READ)
  queryOutcomes(@Query() query: TradeOutcomeQueryDto, @Request() req: any) {
    return this.tradeOutcomeService.queryOutcomes(query, req.user.id);
  }

  /**
   * Stream the authenticated user's full trade history as CSV.
   * GET /trades/export?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
   */
  @Get('export')
  @UseGuards(JwtAuthGuard)
  @RateLimit({ tier: RateLimitTier.AUTHENTICATED, limit: 5, window: 3600 })
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="trade-history.csv"')
  @RequireScopes(ApiKeyScope.TRADES_READ)
  exportCsv(
    @Request() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Res() res?: Response,
  ): void {
    const stream = this.tradeCsvExportService.streamUserTrades(
      req.user.userId ?? req.user.id,
      { startDate, endDate },
    );
    stream.pipe(res!);
  }
}
