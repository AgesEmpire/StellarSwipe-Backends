import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TransactionBatcherService } from './transaction-batcher.service';
import { BatchTransactionsJob } from './jobs/batch-transactions.job';

@Module({
  imports: [ScheduleModule],
  providers: [TransactionBatcherService, BatchTransactionsJob],
  exports: [TransactionBatcherService],
})
export class TransactionBatchingModule {}
