import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  SETTLEMENT_QUEUES,
  SettlementFlowData,
} from '../settlement-flow.constants';

@Processor(SETTLEMENT_QUEUES.STEPS)
export class NotifyUserProcessor extends WorkerHost {
  private readonly logger = new Logger(NotifyUserProcessor.name);

  async process(job: Job<SettlementFlowData>): Promise<{ notified: boolean }> {
    if (job.name !== 'notify-user') return { notified: true };

    const { tradeId, userId } = job.data;
    this.logger.log(`[settle:notify-user] tradeId=${tradeId} userId=${userId}`);

    // In production this calls NotificationsService.
    if (!userId) {
      throw new Error(`Missing userId for notification on trade ${tradeId}`);
    }

    this.logger.log(
      `[settle:notify-user] notification queued for user ${userId}`,
    );
    return { notified: true };
  }
}
