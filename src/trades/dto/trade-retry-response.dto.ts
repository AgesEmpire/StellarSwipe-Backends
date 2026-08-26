import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsUUID,
  ArrayMinSize,
  IsOptional,
  IsString,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

// ---------------------------------------------------------------------------
// Single-trade retry response
// ---------------------------------------------------------------------------

export class TradeRetryResponseDto {
  @ApiProperty({ description: 'ID of the trade being retried' })
  tradeId!: string;

  @ApiProperty({ description: 'ID of the newly enqueued job' })
  newJobId!: string;

  @ApiProperty({ description: 'New status of the trade after retry' })
  status!: string;

  @ApiProperty({ description: 'Human-readable message about the retry' })
  message!: string;
}

// ---------------------------------------------------------------------------
// Failed job detail
// ---------------------------------------------------------------------------

export class FailedJobDto {
  @ApiProperty({ description: 'ID of the failed job' })
  jobId!: string | number;

  @ApiProperty({ description: 'Trade ID associated with the failed job' })
  tradeId!: string;

  @ApiProperty({ description: 'User ID who owns the trade' })
  userId!: string;

  @ApiProperty({ description: 'Reason the job failed' })
  failedReason!: string;

  @ApiProperty({ description: 'Number of attempts made before failure' })
  attemptsMade!: number;

  @ApiProperty({ description: 'ISO timestamp of when the job failed' })
  failedAt!: string;

  @ApiPropertyOptional({ description: 'Original trade job data' })
  tradeData?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Failed jobs summary (admin view)
// ---------------------------------------------------------------------------

export class FailedJobsSummaryDto {
  @ApiProperty({ description: 'Total number of failed trade jobs in the DLQ' })
  totalFailed!: number;

  @ApiProperty({
    description: 'Most recent failed jobs (up to requested limit)',
    type: [FailedJobDto],
  })
  recentJobs!: FailedJobDto[];
}

// ---------------------------------------------------------------------------
// Bulk retry request / response
// ---------------------------------------------------------------------------

export class BulkRetryRequestDto {
  @ApiProperty({
    description: 'Array of trade IDs to retry',
    type: [String],
    example: ['uuid-1', 'uuid-2'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  tradeIds!: string[];
}

export class BulkRetryItemResultDto {
  @ApiProperty({ description: 'Trade ID' })
  tradeId!: string;

  @ApiProperty({ description: 'Whether the retry succeeded' })
  success!: boolean;

  @ApiPropertyOptional({ description: 'New job ID if retry succeeded' })
  newJobId?: string;

  @ApiPropertyOptional({ description: 'Error message if retry failed' })
  error?: string;
}

export class BulkRetryResponseDto {
  @ApiProperty({ description: 'Total trades requested for retry' })
  totalRequested!: number;

  @ApiProperty({ description: 'Number of trades successfully re-enqueued' })
  successCount!: number;

  @ApiProperty({ description: 'Number of trades that failed to retry' })
  failureCount!: number;

  @ApiProperty({
    description: 'Per-trade retry results',
    type: [BulkRetryItemResultDto],
  })
  results!: BulkRetryItemResultDto[];
}

// ---------------------------------------------------------------------------
// Failed trade stats (admin analytics)
// ---------------------------------------------------------------------------

export class ErrorTypeCountDto {
  @ApiProperty({ description: 'Error category / message prefix' })
  errorType!: string;

  @ApiProperty({ description: 'Number of failures with this error type' })
  count!: number;
}

export class TimePeriodCountDto {
  @ApiProperty({ description: 'Time period label (e.g. "last_1h", "last_24h")' })
  period!: string;

  @ApiProperty({ description: 'Number of failures in this period' })
  count!: number;
}

export class FailedTradeStatsDto {
  @ApiProperty({ description: 'Total number of failed trades' })
  totalFailed!: number;

  @ApiProperty({ description: 'Total number of trades successfully retried' })
  totalRetried!: number;

  @ApiProperty({ description: 'Total number of trades discarded from DLQ' })
  totalDiscarded!: number;

  @ApiProperty({
    description: 'Breakdown of failures by error type',
    type: [ErrorTypeCountDto],
  })
  byErrorType!: ErrorTypeCountDto[];

  @ApiProperty({
    description: 'Breakdown of failures by time period',
    type: [TimePeriodCountDto],
  })
  byTimePeriod!: TimePeriodCountDto[];

  @ApiProperty({ description: 'Current DLQ depth (number of entries)' })
  currentDlqDepth!: number;
}

// ---------------------------------------------------------------------------
// Retry history
// ---------------------------------------------------------------------------

export class RetryHistoryEntryDto {
  @ApiProperty({ description: 'ISO timestamp when the retry was initiated' })
  retriedAt!: string;

  @ApiPropertyOptional({ description: 'Error message from the previous failure' })
  previousError?: string;

  @ApiProperty({ description: 'Job ID of the new retry job' })
  newJobId!: string;
}

export class RetryHistoryDto {
  @ApiProperty({ description: 'Trade ID' })
  tradeId!: string;

  @ApiProperty({ description: 'Total number of retry attempts' })
  totalRetries!: number;

  @ApiProperty({
    description: 'Ordered list of retry attempts',
    type: [RetryHistoryEntryDto],
  })
  entries!: RetryHistoryEntryDto[];
}

// ---------------------------------------------------------------------------
// User failed trades
// ---------------------------------------------------------------------------

export class UserFailedTradeDto {
  @ApiProperty({ description: 'Trade ID' })
  tradeId!: string;

  @ApiProperty({ description: 'Trading pair base asset' })
  baseAsset!: string;

  @ApiProperty({ description: 'Trading pair counter asset' })
  counterAsset!: string;

  @ApiProperty({ description: 'Trade side (buy/sell)' })
  side!: string;

  @ApiProperty({ description: 'Trade amount' })
  amount!: string;

  @ApiProperty({ description: 'Entry price' })
  entryPrice!: string;

  @ApiPropertyOptional({ description: 'Error message from the failure' })
  errorMessage?: string;

  @ApiProperty({ description: 'ISO timestamp of when the trade failed' })
  failedAt!: string;

  @ApiProperty({ description: 'Number of retry attempts so far' })
  retryCount!: number;

  @ApiProperty({ description: 'Whether the trade can be retried' })
  canRetry!: boolean;
}

export class UserFailedTradesDto {
  @ApiProperty({ description: 'User ID' })
  userId!: string;

  @ApiProperty({ description: 'Total failed trades for this user' })
  totalFailed!: number;

  @ApiProperty({
    description: 'List of failed trades',
    type: [UserFailedTradeDto],
  })
  trades!: UserFailedTradeDto[];
}

// ---------------------------------------------------------------------------
// Pagination query DTO
// ---------------------------------------------------------------------------

export class DlqPaginationDto {
  @ApiPropertyOptional({
    description: 'Page number (1-indexed)',
    default: 1,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    default: 20,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Sort order (asc or desc)',
    default: 'desc',
  })
  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc';
}

// ---------------------------------------------------------------------------
// Discard response
// ---------------------------------------------------------------------------

export class DiscardResponseDto {
  @ApiProperty({ description: 'Trade ID that was discarded' })
  tradeId!: string;

  @ApiProperty({ description: 'Admin user who performed the discard' })
  discardedBy!: string;

  @ApiProperty({ description: 'ISO timestamp of when the discard occurred' })
  discardedAt!: string;

  @ApiProperty({ description: 'Human-readable message' })
  message!: string;
}

// ---------------------------------------------------------------------------
// Can-retry response
// ---------------------------------------------------------------------------

export class CanRetryResponseDto {
  @ApiProperty({ description: 'Trade ID' })
  tradeId!: string;

  @ApiProperty({ description: 'Whether the trade can be retried' })
  canRetry!: boolean;

  @ApiPropertyOptional({ description: 'Reason why trade cannot be retried' })
  reason?: string;
}
