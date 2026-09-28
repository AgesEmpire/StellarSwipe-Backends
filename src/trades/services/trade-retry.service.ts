import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade, TradeStatus } from '../trades/entities/trade.entity';
import { TradeExecutorService, ExecutionResult } from '../trades/services/trade-executor.service';

export interface RetryLog {
  attempt: number;
  timestamp: Date;
  outcome: 'success' | 'failure';
  error?: string;
}

export interface RetryableError {
  retryable: boolean;
  message: string;
  retryAfterMs?: number;
  logs: RetryLog[];
}

const RETRYABLE_PATTERNS = [
  /network/i,
  /timeout/i,
  /connection/i,
  /rate.?limit/i,
  /temporarily unavailable/i,
  /soroban.*pending/i,
];

@Injectable()
export class TradeRetryService {
  private readonly logger = new Logger(TradeRetryService.name);
  private readonly maxAttempts = 4;
  private readonly baseDelayMs = 500;

  constructor(
    @InjectRepository(Trade)
    private readonly tradeRepository: Repository<Trade>,
    private readonly tradeExecutor: TradeExecutorService,
  ) {}

  async executeWithRetry(
    trade: Trade,
    walletAddress?: string,
  ): Promise<ExecutionResult & { logs: RetryLog[] }> {
    const logs: RetryLog[] = [];

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const timestamp = new Date();
      try {
        const result = await this.tradeExecutor.executeTrade(trade, walletAddress);

        if (result.success) {
          logs.push({ attempt, timestamp, outcome: 'success' });
          this.logger.log(`Trade ${trade.id} succeeded on attempt ${attempt}`);
          return { ...result, logs };
        }

        const isRetryable = this.isRetryableError(result.error ?? '');
        logs.push({ attempt, timestamp, outcome: 'failure', error: result.error });

        if (!isRetryable || attempt === this.maxAttempts) {
          this.logger.warn(`Trade ${trade.id} non-retryable failure: ${result.error}`);
          return { ...result, logs };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logs.push({ attempt, timestamp, outcome: 'failure', error: message });

        if (!this.isRetryableError(message) || attempt === this.maxAttempts) {
          this.logger.error(`Trade ${trade.id} fatal error: ${message}`);
          return { success: false, error: message, logs };
        }
      }

      const delay = this.backoffDelay(attempt);
      this.logger.warn(
        `Trade ${trade.id} attempt ${attempt} failed, retrying in ${delay}ms`,
      );
      await this.sleep(delay);
    }

    return {
      success: false,
      error: 'Trade failed after maximum retry attempts',
      logs,
    };
  }

  async retryFailedTrade(tradeId: string): Promise<RetryableError> {
    const trade = await this.tradeRepository.findOne({ where: { id: tradeId } });

    if (!trade) {
      return { retryable: false, message: 'Trade not found', logs: [] };
    }

    if (trade.status !== TradeStatus.FAILED) {
      return { retryable: false, message: 'Only failed trades can be retried', logs: [] };
    }

    trade.status = TradeStatus.EXECUTING;
    await this.tradeRepository.save(trade);

    const result = await this.executeWithRetry(trade);

    if (result.success) {
      trade.status = TradeStatus.COMPLETED;
      trade.transactionHash = result.transactionHash;
      trade.executedAt = new Date();
    } else {
      trade.status = TradeStatus.FAILED;
      trade.errorMessage = result.error;
    }

    await this.tradeRepository.save(trade);

    return {
      retryable: !result.success,
      message: result.success ? 'Trade succeeded after retry' : result.error ?? 'Retry failed',
      retryAfterMs: result.success ? undefined : 60000,
      logs: result.logs,
    };
  }

  private isRetryableError(message: string): boolean {
    return RETRYABLE_PATTERNS.some((p) => p.test(message));
  }

  private backoffDelay(attempt: number): number {
    return Math.min(this.baseDelayMs * Math.pow(2, attempt - 1), 16000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
