import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  ParseUUIDPipe,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TradeDlqService } from './services/trade-dlq.service';
import { TradeDlqMetricsService, DlqMetricsSnapshot } from './services/trade-dlq-metrics.service';
import { TradeDlqCleanupService } from './services/trade-dlq-cleanup.service';
import {
  TradeRetryResponseDto,
  FailedJobsSummaryDto,
  BulkRetryRequestDto,
  BulkRetryResponseDto,
  FailedTradeStatsDto,
  RetryHistoryDto,
  UserFailedTradesDto,
  CanRetryResponseDto,
  DiscardResponseDto,
} from './dto/trade-retry-response.dto';
import { FailedTradesQueryDto, AdminFailedJobsQueryDto } from './dto/dlq-query.dto';

/**
 * #999 -- Dead-letter queue endpoints for failed trade jobs.
 *
 * User endpoints:
 *   GET    /trades/failed                 -- List user's failed trades
 *   POST   /trades/:id/dlq-retry          -- Re-enqueue a failed trade (owner only)
 *   POST   /trades/bulk-retry             -- Bulk re-enqueue failed trades
 *   GET    /trades/:id/retry-history      -- View retry history for a trade
 *   GET    /trades/:id/can-retry          -- Check if a trade can be retried
 *
 * Admin endpoints:
 *   GET    /admin/trades/failed-jobs       -- View failed queue depth and recent failures
 *   GET    /admin/trades/failed-jobs/stats -- Aggregate failure statistics
 *   POST   /admin/trades/failed-jobs/:id/discard -- Discard a DLQ entry
 *   GET    /admin/trades/dlq-metrics       -- In-memory metrics snapshot
 *   GET    /admin/trades/dlq-cleanup       -- Last cleanup result
 *   POST   /admin/trades/dlq-cleanup/run   -- Trigger cleanup manually
 */
@Controller()
export class TradeDlqController {
  private readonly logger = new Logger(TradeDlqController.name);

  constructor(
    private readonly tradeDlqService: TradeDlqService,
    private readonly metricsService: TradeDlqMetricsService,
    private readonly cleanupService: TradeDlqCleanupService,
  ) {}

  // ── User endpoints ────────────────────────────────────────────────────────

  @Get('trades/failed')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiTags('Trades')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List failed trades for the authenticated user',
    description:
      'Returns a paginated list of failed trades owned by the current user. ' +
      'Supports filtering by base asset and error message.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sortBy', required: false, type: String })
  @ApiQuery({ name: 'sortOrder', required: false, enum: ['ASC', 'DESC'] })
  @ApiQuery({ name: 'baseAsset', required: false, type: String })
  @ApiQuery({ name: 'errorFilter', required: false, type: String })
  @ApiResponse({
    status: 200,
    description: 'Paginated list of failed trades',
    type: UserFailedTradesDto,
  })
  async getUserFailedTrades(
    @Request() req: any,
    @Query() query: FailedTradesQueryDto,
  ): Promise<UserFailedTradesDto> {
    const userId = req.user?.id;
    return this.tradeDlqService.getFailedTradesByUser(
      userId,
      query.page ?? 1,
      Math.min(query.limit ?? 20, 100),
      query.sortBy ?? 'updatedAt',
      query.sortOrder ?? 'DESC',
      query.baseAsset,
      query.errorFilter,
    );
  }

  @Post('trades/:id/dlq-retry')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiTags('Trades')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Retry a permanently failed trade',
    description:
      'Re-enqueues a trade job that has been moved to the dead-letter queue. ' +
      'Only the trade owner can retry their own trades. The trade must be in FAILED status.',
  })
  @ApiParam({ name: 'id', description: 'Trade ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Trade successfully re-enqueued',
    type: TradeRetryResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Trade is not in FAILED status or cannot be retried' })
  @ApiResponse({ status: 403, description: 'User does not own this trade' })
  @ApiResponse({ status: 404, description: 'Trade not found' })
  async retryFailedTrade(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ): Promise<TradeRetryResponseDto> {
    const userId = req.user?.id;
    this.logger.log(`User ${userId} requesting retry for trade ${id}`);
    return this.tradeDlqService.retryTrade(id, userId);
  }

  @Post('trades/bulk-retry')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiTags('Trades')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Bulk retry multiple failed trades',
    description:
      'Re-enqueues multiple failed trade jobs at once. Each trade is retried independently; ' +
      'partial failures do not affect other trades in the batch.',
  })
  @ApiResponse({
    status: 200,
    description: 'Bulk retry results',
    type: BulkRetryResponseDto,
  })
  async bulkRetryTrades(
    @Body() dto: BulkRetryRequestDto,
    @Request() req: any,
  ): Promise<BulkRetryResponseDto> {
    const userId = req.user?.id;
    this.logger.log(
      `User ${userId} requesting bulk retry for ${dto.tradeIds.length} trade(s)`,
    );
    return this.tradeDlqService.bulkRetry(dto.tradeIds, userId);
  }

  @Get('trades/:id/retry-history')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiTags('Trades')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get retry history for a trade',
    description:
      'Returns the list of all retry attempts for a specific trade, ' +
      'including timestamps and previous error messages.',
  })
  @ApiParam({ name: 'id', description: 'Trade ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Retry history',
    type: RetryHistoryDto,
  })
  @ApiResponse({ status: 403, description: 'User does not own this trade' })
  @ApiResponse({ status: 404, description: 'Trade not found' })
  async getRetryHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ): Promise<RetryHistoryDto> {
    const userId = req.user?.id;
    return this.tradeDlqService.getRetryHistory(id, userId);
  }

  @Get('trades/:id/can-retry')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiTags('Trades')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Check if a trade can be retried',
    description:
      'Validates all business rules (ownership, status, retry limit, cooldown) ' +
      'and returns whether the trade is eligible for retry.',
  })
  @ApiParam({ name: 'id', description: 'Trade ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Can-retry check result',
    type: CanRetryResponseDto,
  })
  async checkCanRetry(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ): Promise<CanRetryResponseDto> {
    const userId = req.user?.id;
    return this.tradeDlqService.canRetry(id, userId);
  }

  // ── Admin endpoints ───────────────────────────────────────────────────────

  @Get('admin/trades/failed-jobs')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Admin Management')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'View failed trade job queue depth and recent failures',
    description:
      'Returns the total number of permanently failed trade jobs in the dead-letter queue ' +
      'along with details of the most recent failures.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: 200,
    description: 'Failed jobs summary',
    type: FailedJobsSummaryDto,
  })
  async getFailedJobs(
    @Query() query: AdminFailedJobsQueryDto,
  ): Promise<FailedJobsSummaryDto> {
    this.logger.log('Admin requesting failed trade jobs summary');
    return this.tradeDlqService.getFailedJobs(query.limit ?? 10);
  }

  @Get('admin/trades/failed-jobs/stats')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Admin Management')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get aggregate statistics for failed trade jobs',
    description:
      'Returns aggregated failure statistics including breakdowns by error type, ' +
      'time period, and current DLQ depth.',
  })
  @ApiResponse({
    status: 200,
    description: 'Failed trade statistics',
    type: FailedTradeStatsDto,
  })
  async getFailedJobStats(): Promise<FailedTradeStatsDto> {
    this.logger.log('Admin requesting failed trade job statistics');
    return this.tradeDlqService.getFailedTradeStats();
  }

  @Post('admin/trades/failed-jobs/:id/discard')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Admin Management')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Discard a failed trade from the DLQ',
    description:
      'Permanently removes a failed trade job from the dead-letter queue. ' +
      'The trade remains in FAILED status but is marked as discarded.',
  })
  @ApiParam({ name: 'id', description: 'Trade ID (UUID)' })
  @ApiResponse({
    status: 200,
    description: 'Trade discarded successfully',
    type: DiscardResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Trade is not in FAILED status' })
  @ApiResponse({ status: 404, description: 'Trade not found' })
  async discardFailedJob(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ): Promise<DiscardResponseDto> {
    const adminUserId = req.user?.id ?? 'system';
    this.logger.log(`Admin ${adminUserId} discarding DLQ entry for trade ${id}`);
    return this.tradeDlqService.discardFailedJob(id, adminUserId);
  }

  @Get('admin/trades/dlq-metrics')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Admin Management')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get in-memory DLQ metrics',
    description:
      'Returns a snapshot of in-memory DLQ metrics including failure counts, ' +
      'retry rates, and failure reason distribution.',
  })
  @ApiResponse({ status: 200, description: 'DLQ metrics snapshot' })
  async getDlqMetrics(): Promise<DlqMetricsSnapshot> {
    return this.metricsService.getMetrics();
  }

  @Get('admin/trades/dlq-cleanup')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Admin Management')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get last DLQ cleanup result',
    description: 'Returns the result of the most recent DLQ cleanup run.',
  })
  @ApiResponse({ status: 200, description: 'Last cleanup result' })
  async getCleanupStatus() {
    return {
      ...this.cleanupService.getLastCleanupResult(),
      config: this.cleanupService.getRetentionConfig(),
    };
  }

  @Post('admin/trades/dlq-cleanup/run')
  @HttpCode(HttpStatus.OK)
  @ApiTags('Admin Management')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Trigger DLQ cleanup manually',
    description: 'Manually triggers the DLQ cleanup process. This is normally run daily at 3 AM.',
  })
  @ApiQuery({ name: 'retentionDays', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Cleanup result' })
  async triggerCleanup(
    @Query('retentionDays', new DefaultValuePipe(90), ParseIntPipe)
    retentionDays: number,
  ) {
    this.logger.log(`Admin manually triggering DLQ cleanup (retention: ${retentionDays} days)`);
    const result = await this.cleanupService.cleanupOldEntries(retentionDays);
    return result;
  }
}
