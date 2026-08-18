import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';
import { ConfigService } from '@nestjs/config';
import { Trade, TradeStatus } from '../entities/trade.entity';
import { DeadLetterService } from '../../jobs/dead-letter.service';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationChannel } from '../../notifications/entities/notification.entity';
import {
  TradeRetryResponseDto,
  FailedJobDto,
  FailedJobsSummaryDto,
  BulkRetryItemResultDto,
  BulkRetryResponseDto,
  FailedTradeStatsDto,
  ErrorTypeCountDto,
  TimePeriodCountDto,
  RetryHistoryDto,
  RetryHistoryEntryDto,
  UserFailedTradeDto,
  UserFailedTradesDto,
  CanRetryResponseDto,
  DiscardResponseDto,
} from '../dto/trade-retry-response.dto';

const MAX_RETRY_ATTEMPTS = 5;
const RETRY_COOLDOWN_MS = 60_000; // 1 minute between retries for same trade

/**
 * #999 -- Dead-letter queue handler service for permanently failed trade jobs.
 *
 * Responsibilities:
 * - Updating trade records to FAILED when a job exhausts all retries
 * - Storing failure details (reason + attempt count) on the trade entity
 * - Sending user notifications with the failure reason and a retry CTA
 * - Re-enqueueing failed trade jobs on user request (with ownership validation)
 * - Providing admin views over failed trade jobs in the DLQ
 * - Bulk retry support for multiple failed trades
 * - Retry history tracking and business rule validation
 */
@Injectable()
export class TradeDlqService {
  private readonly logger = new Logger(TradeDlqService.name);
  private readonly maxRetryAttempts: number;
  private readonly retryCooldownMs: number;

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    @InjectQueue('transactions')
    private readonly transactionsQueue: Queue,
    private readonly deadLetterService: DeadLetterService,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) {
    this.maxRetryAttempts = this.configService.get<number>(
      'dlq.maxRetryAttempts',
      MAX_RETRY_ATTEMPTS,
    );
    this.retryCooldownMs = this.configService.get<number>(
      'dlq.retryCooldownMs',
      RETRY_COOLDOWN_MS,
    );
  }

  /**
   * Handle a permanently failed trade job.
   *
   * Called by the TradeDlqProcessor when a job on the transactions queue
   * has exhausted all retry attempts.
   */
  async handleFailedJob(job: Job, error: Error): Promise<void> {
    const tradeId: string | undefined = job.data?.tradeId;

    if (!tradeId) {
      this.logger.warn(
        `Failed job ${job.id} has no tradeId in data — skipping trade update`,
      );
      await this.deadLetterService.capture(job, error);
      return;
    }

    this.logger.warn(
      `Trade job ${job.id} for trade ${tradeId} permanently failed after ${job.attemptsMade} attempt(s): ${error.message}`,
    );

    const trade = await this.tradeRepository.findOne({ where: { id: tradeId } });

    if (!trade) {
      this.logger.error(
        `Trade ${tradeId} not found in database — cannot mark as FAILED`,
      );
      await this.deadLetterService.capture(job, error);
      return;
    }

    trade.status = TradeStatus.FAILED;
    trade.errorMessage = error.message;
    trade.metadata = {
      ...trade.metadata,
      dlq: {
        jobId: job.id,
        attemptsMade: job.attemptsMade,
        failedAt: new Date().toISOString(),
        failedReason: error.message,
      },
    };

    await this.tradeRepository.save(trade);

    this.logger.log(
      `Trade ${tradeId} updated to FAILED status with error: ${error.message}`,
    );

    await this.deadLetterService.capture(job, error);

    await this.sendFailureNotification(trade, error.message, job.attemptsMade);
  }

  /**
   * Retry a failed trade by re-enqueueing its original job data.
   */
  async retryTrade(
    tradeId: string,
    userId: string,
  ): Promise<TradeRetryResponseDto> {
    const trade = await this.tradeRepository.findOne({
      where: { id: tradeId },
    });

    if (!trade) {
      throw new NotFoundException(`Trade ${tradeId} not found`);
    }

    if (trade.userId !== userId) {
      throw new ForbiddenException(
        'You are not authorized to retry this trade',
      );
    }

    if (trade.status !== TradeStatus.FAILED) {
      throw new BadRequestException(
        `Trade ${tradeId} is not in FAILED status (current: ${trade.status}). Only failed trades can be retried.`,
      );
    }

    const canRetryResult = await this.canRetry(tradeId, userId);
    if (!canRetryResult.canRetry) {
      throw new BadRequestException(
        canRetryResult.reason || 'Trade cannot be retried at this time',
      );
    }

    const originalJobData = this.buildRetryJobData(trade);

    const newJob = await this.transactionsQueue.add('execute-trade', originalJobData, {
      priority: 100,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    trade.status = TradeStatus.PENDING;
    trade.errorMessage = undefined;
    trade.metadata = {
      ...trade.metadata,
      retryHistory: [
        ...((trade.metadata?.retryHistory as any[]) || []),
        {
          retriedAt: new Date().toISOString(),
          previousError: trade.metadata?.dlq
            ? (trade.metadata.dlq as Record<string, unknown>).failedReason
            : undefined,
          newJobId: newJob.id,
        },
      ],
      dlq: undefined,
    };

    await this.tradeRepository.save(trade);

    this.logger.log(
      `Trade ${tradeId} retried by user ${userId} — new job ${newJob.id}`,
    );

    return {
      tradeId: trade.id,
      newJobId: String(newJob.id),
      status: TradeStatus.PENDING,
      message: `Trade ${tradeId} has been re-enqueued for processing`,
    };
  }

  /**
   * Retry multiple failed trades at once.
   */
  async bulkRetry(
    tradeIds: string[],
    userId: string,
  ): Promise<BulkRetryResponseDto> {
    const results: BulkRetryItemResultDto[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (const tradeId of tradeIds) {
      try {
        const retryResult = await this.retryTrade(tradeId, userId);
        results.push({
          tradeId,
          success: true,
          newJobId: retryResult.newJobId,
        });
        successCount++;
      } catch (error: any) {
        results.push({
          tradeId,
          success: false,
          error: error.message,
        });
        failureCount++;
        this.logger.warn(
          `Bulk retry failed for trade ${tradeId}: ${error.message}`,
        );
      }
    }

    this.logger.log(
      `Bulk retry completed: ${successCount} succeeded, ${failureCount} failed out of ${tradeIds.length}`,
    );

    return {
      totalRequested: tradeIds.length,
      successCount,
      failureCount,
      results,
    };
  }

  /**
   * Return the most recent failed trade jobs from the DLQ.
   */
  async getFailedJobs(limit: number = 10): Promise<FailedJobsSummaryDto> {
    const allDlqJobs = await this.deadLetterService.list();

    const tradeJobs = allDlqJobs.filter(
      (job) => job.data?.queue === 'transactions',
    );

    const totalFailed = tradeJobs.length;

    const sorted = tradeJobs
      .sort((a, b) => {
        const dateA = a.data?.failedAt || '';
        const dateB = b.data?.failedAt || '';
        return dateB.localeCompare(dateA);
      })
      .slice(0, limit);

    const recentJobs: FailedJobDto[] = sorted.map((job) => ({
      jobId: job.data?.jobId ?? job.id,
      tradeId: (job.data?.data as Record<string, unknown>)?.tradeId as string || 'unknown',
      userId: (job.data?.data as Record<string, unknown>)?.userId as string || 'unknown',
      failedReason: job.data?.failedReason || 'Unknown error',
      attemptsMade: job.data?.attemptsMade || 0,
      failedAt: job.data?.failedAt || new Date().toISOString(),
      tradeData: job.data?.data as Record<string, unknown> | undefined,
    }));

    return {
      totalFailed,
      recentJobs,
    };
  }

  /**
   * Return the total count of failed trade jobs currently in the DLQ.
   */
  async getFailedJobsCount(): Promise<number> {
    const allDlqJobs = await this.deadLetterService.list();

    return allDlqJobs.filter(
      (job) => job.data?.queue === 'transactions',
    ).length;
  }

  /**
   * Get failed trades for a specific user with pagination.
   */
  async getFailedTradesByUser(
    userId: string,
    page: number = 1,
    limit: number = 20,
    sortBy: string = 'updatedAt',
    sortOrder: 'ASC' | 'DESC' = 'DESC',
    baseAsset?: string,
    errorFilter?: string,
  ): Promise<UserFailedTradesDto> {
    const queryBuilder = this.tradeRepository
      .createQueryBuilder('trade')
      .where('trade.userId = :userId', { userId })
      .andWhere('trade.status = :status', { status: TradeStatus.FAILED });

    if (baseAsset) {
      queryBuilder.andWhere('trade.baseAsset = :baseAsset', { baseAsset });
    }

    if (errorFilter) {
      queryBuilder.andWhere('trade.errorMessage ILIKE :errorFilter', {
        errorFilter: `%${errorFilter}%`,
      });
    }

    const validSortFields: Record<string, string> = {
      updatedAt: 'trade.updatedAt',
      createdAt: 'trade.createdAt',
      amount: 'trade.amount',
      baseAsset: 'trade.baseAsset',
    };
    const sortField = validSortFields[sortBy] || 'trade.updatedAt';

    queryBuilder
      .orderBy(sortField, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    const [trades, totalFailed] = await queryBuilder.getManyAndCount();

    const tradeItems: UserFailedTradeDto[] = trades.map((trade) => {
      const retryHistory = (trade.metadata?.retryHistory as any[]) || [];
      return {
        tradeId: trade.id,
        baseAsset: trade.baseAsset,
        counterAsset: trade.counterAsset,
        side: trade.side,
        amount: trade.amount,
        entryPrice: trade.entryPrice,
        errorMessage: trade.errorMessage,
        failedAt: trade.metadata?.dlq
          ? String((trade.metadata.dlq as Record<string, unknown>).failedAt)
          : trade.updatedAt.toISOString(),
        retryCount: retryHistory.length,
        canRetry: retryHistory.length < this.maxRetryAttempts,
      };
    });

    return {
      userId,
      totalFailed,
      trades: tradeItems,
    };
  }

  /**
   * Get aggregate statistics for failed trade jobs.
   */
  async getFailedTradeStats(): Promise<FailedTradeStatsDto> {
    const failedTrades = await this.tradeRepository.find({
      where: { status: TradeStatus.FAILED },
      select: ['id', 'errorMessage', 'metadata', 'updatedAt', 'createdAt'],
    });

    const totalFailed = failedTrades.length;

    // Count retried trades (those with retryHistory in metadata)
    let totalRetried = 0;
    let totalDiscarded = 0;
    const errorTypeCounts: Record<string, number> = {};

    for (const trade of failedTrades) {
      const retryHistory = (trade.metadata?.retryHistory as any[]) || [];
      totalRetried += retryHistory.length;

      if (trade.metadata?.discarded) {
        totalDiscarded++;
      }

      const errorKey = this.categorizeError(trade.errorMessage || 'Unknown');
      errorTypeCounts[errorKey] = (errorTypeCounts[errorKey] || 0) + 1;
    }

    const byErrorType: ErrorTypeCountDto[] = Object.entries(errorTypeCounts)
      .map(([errorType, count]) => ({ errorType, count }))
      .sort((a, b) => b.count - a.count);

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const byTimePeriod: TimePeriodCountDto[] = [
      {
        period: 'last_1h',
        count: failedTrades.filter((t) => t.updatedAt >= oneHourAgo).length,
      },
      {
        period: 'last_24h',
        count: failedTrades.filter((t) => t.updatedAt >= oneDayAgo).length,
      },
      {
        period: 'last_7d',
        count: failedTrades.filter((t) => t.updatedAt >= oneWeekAgo).length,
      },
      {
        period: 'last_30d',
        count: failedTrades.filter((t) => t.updatedAt >= oneMonthAgo).length,
      },
    ];

    const currentDlqDepth = await this.getFailedJobsCount();

    return {
      totalFailed,
      totalRetried,
      totalDiscarded,
      byErrorType,
      byTimePeriod,
      currentDlqDepth,
    };
  }

  /**
   * Discard a failed trade job from the DLQ (admin action).
   */
  async discardFailedJob(
    tradeId: string,
    adminUserId: string,
  ): Promise<DiscardResponseDto> {
    const trade = await this.tradeRepository.findOne({
      where: { id: tradeId },
    });

    if (!trade) {
      throw new NotFoundException(`Trade ${tradeId} not found`);
    }

    if (trade.status !== TradeStatus.FAILED) {
      throw new BadRequestException(
        `Trade ${tradeId} is not in FAILED status (current: ${trade.status})`,
      );
    }

    // Find and remove the corresponding DLQ entry
    const dlqJobs = await this.deadLetterService.list();
    const matchingJob = dlqJobs.find((job) => {
      const jobData = job.data?.data as Record<string, unknown> | undefined;
      return jobData?.tradeId === tradeId;
    });

    if (matchingJob) {
      await this.deadLetterService.discard(String(matchingJob.id));
    }

    // Mark the trade as discarded in metadata
    trade.metadata = {
      ...trade.metadata,
      discarded: {
        discardedBy: adminUserId,
        discardedAt: new Date().toISOString(),
      },
    };

    await this.tradeRepository.save(trade);

    this.logger.log(
      `Trade ${tradeId} DLQ entry discarded by admin ${adminUserId}`,
    );

    return {
      tradeId,
      discardedBy: adminUserId,
      discardedAt: new Date().toISOString(),
      message: `DLQ entry for trade ${tradeId} has been discarded`,
    };
  }

  /**
   * Get retry history for a specific trade.
   */
  async getRetryHistory(
    tradeId: string,
    userId: string,
  ): Promise<RetryHistoryDto> {
    const trade = await this.tradeRepository.findOne({
      where: { id: tradeId },
    });

    if (!trade) {
      throw new NotFoundException(`Trade ${tradeId} not found`);
    }

    if (trade.userId !== userId) {
      throw new ForbiddenException(
        'You are not authorized to view this trade\'s retry history',
      );
    }

    const retryHistory = (trade.metadata?.retryHistory as any[]) || [];

    const entries: RetryHistoryEntryDto[] = retryHistory.map((entry: any) => ({
      retriedAt: entry.retriedAt,
      previousError: entry.previousError,
      newJobId: String(entry.newJobId),
    }));

    return {
      tradeId,
      totalRetries: entries.length,
      entries,
    };
  }

  /**
   * Check if a trade can be retried (business rule validation).
   */
  async canRetry(
    tradeId: string,
    userId: string,
  ): Promise<CanRetryResponseDto> {
    const trade = await this.tradeRepository.findOne({
      where: { id: tradeId },
    });

    if (!trade) {
      return {
        tradeId,
        canRetry: false,
        reason: 'Trade not found',
      };
    }

    if (trade.userId !== userId) {
      return {
        tradeId,
        canRetry: false,
        reason: 'You do not own this trade',
      };
    }

    if (trade.status !== TradeStatus.FAILED) {
      return {
        tradeId,
        canRetry: false,
        reason: `Trade is in ${trade.status} status, not FAILED`,
      };
    }

    // Check retry count limit
    const retryHistory = (trade.metadata?.retryHistory as any[]) || [];
    if (retryHistory.length >= this.maxRetryAttempts) {
      return {
        tradeId,
        canRetry: false,
        reason: `Maximum retry attempts (${this.maxRetryAttempts}) exceeded`,
      };
    }

    // Check retry cooldown
    if (retryHistory.length > 0) {
      const lastRetry = retryHistory[retryHistory.length - 1];
      const lastRetryTime = new Date(lastRetry.retriedAt).getTime();
      const now = Date.now();
      if (now - lastRetryTime < this.retryCooldownMs) {
        const waitSeconds = Math.ceil(
          (this.retryCooldownMs - (now - lastRetryTime)) / 1000,
        );
        return {
          tradeId,
          canRetry: false,
          reason: `Please wait ${waitSeconds} second(s) before retrying again`,
        };
      }
    }

    // Check if trade was discarded
    if (trade.metadata?.discarded) {
      return {
        tradeId,
        canRetry: false,
        reason: 'Trade has been discarded by an administrator',
      };
    }

    return {
      tradeId,
      canRetry: true,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private buildRetryJobData(trade: Trade): Record<string, unknown> {
    return {
      tradeId: trade.id,
      userId: trade.userId,
      signalId: trade.signalId,
      side: trade.side,
      baseAsset: trade.baseAsset,
      counterAsset: trade.counterAsset,
      entryPrice: trade.entryPrice,
      amount: trade.amount,
      totalValue: trade.totalValue,
      stopLossPrice: trade.stopLossPrice,
      takeProfitPrice: trade.takeProfitPrice,
      isRetry: true,
    };
  }

  private async sendFailureNotification(
    trade: Trade,
    failedReason: string,
    attemptsMade: number,
  ): Promise<void> {
    try {
      const pair = `${trade.baseAsset}/${trade.counterAsset}`;
      const sideLabel = trade.side.toUpperCase();

      await this.notificationService.send({
        userId: trade.userId,
        type: 'TRADE_EXECUTED',
        title: 'Trade Failed',
        message:
          `Your ${sideLabel} trade for ${trade.amount} ${pair} has permanently failed ` +
          `after ${attemptsMade} attempt(s). Reason: ${failedReason}. ` +
          `You can retry this trade from your trade history.`,
        channel: NotificationChannel.IN_APP,
        metadata: {
          tradeId: trade.id,
          action: 'TRADE_FAILED',
          failedReason,
          attemptsMade,
          retryUrl: `/trades/${trade.id}/retry`,
          side: trade.side,
          baseAsset: trade.baseAsset,
          counterAsset: trade.counterAsset,
          amount: trade.amount,
        },
      });

      this.logger.log(
        `Failure notification sent to user ${trade.userId} for trade ${trade.id}`,
      );
    } catch (notifError: any) {
      this.logger.error(
        `Failed to send notification for trade ${trade.id}: ${notifError.message}`,
        notifError.stack,
      );
    }
  }

  private categorizeError(errorMessage: string): string {
    const lowerMessage = errorMessage.toLowerCase();

    if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
      return 'Timeout';
    }
    if (lowerMessage.includes('insufficient') || lowerMessage.includes('balance')) {
      return 'Insufficient Balance';
    }
    if (lowerMessage.includes('network') || lowerMessage.includes('connection')) {
      return 'Network Error';
    }
    if (lowerMessage.includes('soroban') || lowerMessage.includes('contract')) {
      return 'Smart Contract Error';
    }
    if (lowerMessage.includes('rpc') || lowerMessage.includes('horizon')) {
      return 'RPC/Horizon Error';
    }
    if (lowerMessage.includes('slippage')) {
      return 'Slippage Exceeded';
    }
    if (lowerMessage.includes('duplicate') || lowerMessage.includes('already')) {
      return 'Duplicate Transaction';
    }
    return 'Other';
  }
}
