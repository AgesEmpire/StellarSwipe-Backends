import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  SETTLEMENT_QUEUES,
  SettlementFlowData,
} from '../settlement-flow.constants';

@Processor(SETTLEMENT_QUEUES.STEPS)
export class ConfirmOnChainProcessor extends WorkerHost {
  private readonly logger = new Logger(ConfirmOnChainProcessor.name);

  async process(
    job: Job<SettlementFlowData>,
  ): Promise<{ confirmed: boolean; blockHeight?: number }> {
    if (job.name !== 'confirm-on-chain') return { confirmed: true };

    const { tradeId, txHash } = job.data;
    this.logger.log(
      `[settle:confirm-on-chain] tradeId=${tradeId} txHash=${txHash}`,
    );

    // In production this calls the Soroban/Stellar RPC to check the tx.
    // Simulate confirmation check — throws on any falsy txHash to surface failures.
    if (!txHash) {
      throw new Error(`Missing txHash for trade ${tradeId}`);
    }

    const blockHeight = Math.floor(Math.random() * 1_000_000) + 1;
    this.logger.log(
      `[settle:confirm-on-chain] confirmed at blockHeight=${blockHeight}`,
    );

    return { confirmed: true, blockHeight };
  }
}
