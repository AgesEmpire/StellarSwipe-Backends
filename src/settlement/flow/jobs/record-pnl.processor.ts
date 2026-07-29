import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  SETTLEMENT_QUEUES,
  SettlementFlowData,
} from '../settlement-flow.constants';

@Processor(SETTLEMENT_QUEUES.STEPS)
export class RecordPnlProcessor extends WorkerHost {
  private readonly logger = new Logger(RecordPnlProcessor.name);

  async process(
    job: Job<SettlementFlowData>,
  ): Promise<{ pnlRecorded: boolean; pnl?: string }> {
    if (job.name !== 'record-pnl') return { pnlRecorded: true };

    const { tradeId, entryPrice, exitPrice, amount } = job.data;
    this.logger.log(`[settle:record-pnl] tradeId=${tradeId}`);

    if (!entryPrice) {
      throw new Error(
        `Missing entryPrice for P&L calculation on trade ${tradeId}`,
      );
    }

    const entry = parseFloat(entryPrice);
    const exit = exitPrice ? parseFloat(exitPrice) : entry;
    const qty = parseFloat(amount);
    const pnl = ((exit - entry) * qty).toFixed(8);

    this.logger.log(`[settle:record-pnl] tradeId=${tradeId} pnl=${pnl}`);
    return { pnlRecorded: true, pnl };
  }
}
