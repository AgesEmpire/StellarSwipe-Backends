import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  SETTLEMENT_QUEUES,
  SettlementFlowData,
} from '../settlement-flow.constants';

@Processor(SETTLEMENT_QUEUES.STEPS)
export class UpdateBalancesProcessor extends WorkerHost {
  private readonly logger = new Logger(UpdateBalancesProcessor.name);

  async process(job: Job<SettlementFlowData>): Promise<{ updated: boolean }> {
    if (job.name !== 'update-balances') return { updated: true };

    const { tradeId, userId, amount } = job.data;
    this.logger.log(
      `[settle:update-balances] tradeId=${tradeId} userId=${userId} amount=${amount}`,
    );

    // In production this calls WalletService to debit/credit user balances.
    if (!userId || !amount) {
      throw new Error(`Missing userId or amount for trade ${tradeId}`);
    }

    this.logger.log(
      `[settle:update-balances] balances updated for user ${userId}`,
    );
    return { updated: true };
  }
}
