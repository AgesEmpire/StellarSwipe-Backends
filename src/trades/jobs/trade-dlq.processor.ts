import { Injectable, Logger } from '@nestjs/common';
import { Processor, OnQueueFailed, OnQueueCompleted, OnQueueStalled } from '@nestjs/bull';
import { Job } from 'bull';
import { TradeDlqService } from '../services/trade-dlq.service';
import { TradeDlqMetricsService } from '../services/trade-dlq-metrics.service';

/**
 * #999 -- Dead-letter queue processor for the `transactions` queue.
 *
 * Listens for failed jobs on the Bull `transactions` queue. When a job
 * has exhausted all its retry attempts the processor delegates to
 * `TradeDlqService.handleFailedJob()` which updates the trade record,
 * captures the job to the DLQ, and notifies the user.
 *
 * Also tracks metrics on completions and stalled jobs for observability.
 */
@Injectable()
@Processor('transactions')
export class TradeDlqProcessor {
  private readonly logger = new Logger(TradeDlqProcessor.name);

  constructor(
    private readonly tradeDlqService: TradeDlqService,
    private readonly metricsService: TradeDlqMetricsService,
  ) {}

  @OnQueueFailed()
  async onFailed(job: Job, error: Error): Promise<void> {
    const tradeId = job.data?.tradeId ?? 'unknown';
    const maxAttempts = job.opts?.attempts ?? 1;

    this.logger.warn(
      `Job ${job.id} failed (trade=${tradeId}, attempt ${job.attemptsMade}/${maxAttempts}): ${error.message}`,
    );

    if (job.attemptsMade < maxAttempts) {
      this.logger.debug(
        `Job ${job.id} will be retried (${maxAttempts - job.attemptsMade} attempt(s) remaining)`,
      );
      return;
    }

    this.logger.error(
      `Job ${job.id} has exhausted all ${maxAttempts} attempt(s) — moving to DLQ`,
    );

    // Record failure in metrics
    this.metricsService.recordFailure(tradeId, error.message);

    try {
      await this.tradeDlqService.handleFailedJob(job, error);
    } catch (dlqError: any) {
      this.logger.error(
        `Error in DLQ processing for job ${job.id}: ${dlqError.message}`,
        dlqError.stack,
      );
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job): void {
    const tradeId = job.data?.tradeId ?? 'unknown';
    const isRetry = job.data?.isRetry === true;

    if (isRetry) {
      this.metricsService.recordRetry(tradeId, true);
      this.logger.log(
        `Retry job ${job.id} for trade ${tradeId} completed successfully`,
      );
    }
  }

  @OnQueueStalled()
  onStalled(job: Job): void {
    const tradeId = job.data?.tradeId ?? 'unknown';
    this.logger.warn(
      `Job ${job.id} for trade ${tradeId} has stalled — it may be retried automatically`,
    );
  }
}
