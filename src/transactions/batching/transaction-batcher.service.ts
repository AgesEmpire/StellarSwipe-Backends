import { Injectable, Logger } from '@nestjs/common';
import { groupByAsset, buildBatch, sortByPriority, BatchableTransaction, TransactionBatch } from './utils/batch-optimizer';
import * as crypto from 'crypto';

@Injectable()
export class TransactionBatcherService {
  private readonly logger = new Logger(TransactionBatcherService.name);
  private readonly pendingQueue: BatchableTransaction[] = [];
  private readonly processedBatches = new Map<string, TransactionBatch>();

  addToBatch(transaction: BatchableTransaction): void {
    this.pendingQueue.push(transaction);
    this.logger.debug(`Added transaction ${transaction.id} to pending queue`);
  }

  async processPendingBatch(maxBatchSize = 50): Promise<number> {
    if (this.pendingQueue.length === 0) return 0;

    const toProcess = this.pendingQueue.splice(0, maxBatchSize);
    const sorted = sortByPriority(toProcess);
    const groups = groupByAsset(sorted);

    let totalProcessed = 0;

    for (const [asset, transactions] of groups.entries()) {
      const batchId = crypto.randomUUID();
      const batch = buildBatch(transactions, batchId);
      this.processedBatches.set(batchId, batch);

      this.logger.log(`Batch ${batchId}: ${transactions.length} txs for ${asset}, fee: ${batch.estimatedFee}`);
      totalProcessed += transactions.length;
    }

    return totalProcessed;
  }

  createBatch(transactions: BatchableTransaction[]): TransactionBatch {
    if (transactions.length === 0) {
      throw new Error('Cannot create batch with no transactions');
    }

    const sorted = sortByPriority(transactions);
    const batchId = crypto.randomUUID();
    const batch = buildBatch(sorted, batchId);
    this.processedBatches.set(batchId, batch);

    this.logger.log(`Created batch ${batchId} with ${transactions.length} transactions`);
    return batch;
  }

  getBatch(batchId: string): TransactionBatch | undefined {
    return this.processedBatches.get(batchId);
  }

  getPendingCount(): number {
    return this.pendingQueue.length;
  }
}
