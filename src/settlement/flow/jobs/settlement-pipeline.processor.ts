import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  SETTLEMENT_QUEUES,
  SettlementFlowData,
} from '../settlement-flow.constants';

export interface SettlementPipelineResult {
  success: boolean;
  tradeId: string;
  completedAt: Date;
  childResults: Record<string, unknown>;
}

@Processor(SETTLEMENT_QUEUES.PIPELINE)
export class SettlementPipelineProcessor extends WorkerHost {
  private readonly logger = new Logger(SettlementPipelineProcessor.name);

  /**
   * The parent job runs only after ALL child jobs complete successfully.
   * BullMQ FlowProducer populates `job.data.childrenValues` with each
   * child's return value, keyed by `<queue>:<jobId>`.
   */
  async process(
    job: Job<SettlementFlowData>,
  ): Promise<SettlementPipelineResult> {
    const { tradeId } = job.data;
    this.logger.log(
      `[settle:pipeline] parent job running for tradeId=${tradeId}`,
    );

    const childrenValues = (await job.getChildrenValues()) as Record<
      string,
      unknown
    >;

    const successCount = Object.keys(childrenValues).length;
    this.logger.log(
      `[settle:pipeline] tradeId=${tradeId} — all ${successCount} child steps completed`,
    );

    return {
      success: true,
      tradeId,
      completedAt: new Date(),
      childResults: childrenValues,
    };
  }
}
