import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TransactionBatcherService } from '../transaction-batcher.service';

@Injectable()
export class BatchTransactionsJob {
  private readonly logger = new Logger(BatchTransactionsJob.name);

  constructor(private readonly batcherService: TransactionBatcherService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleBatching(): Promise<void> {
    this.logger.log('Running transaction batching job');
    try {
      const batched = await this.batcherService.processPendingBatch();
      this.logger.log(`Processed ${batched} transactions in batch`);
    } catch (err) {
      this.logger.error('Batch processing failed', err);
    }
  }
}
