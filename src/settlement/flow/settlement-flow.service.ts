import { Injectable, Logger } from '@nestjs/common';
import { InjectFlowProducer } from '@nestjs/bullmq';
import { FlowProducer, FlowJob } from 'bullmq';
import {
  SETTLEMENT_JOBS,
  SETTLEMENT_QUEUES,
  SettlementFlowData,
} from './settlement-flow.constants';

export const SETTLEMENT_FLOW_PRODUCER = 'settlement-flow-producer';

@Injectable()
export class SettlementFlowService {
  private readonly logger = new Logger(SettlementFlowService.name);

  constructor(
    @InjectFlowProducer(SETTLEMENT_FLOW_PRODUCER)
    private readonly flowProducer: FlowProducer,
  ) {}

  /**
   * Enqueues the full multi-step settlement pipeline as a BullMQ flow.
   *
   * The parent job (settlement-pipeline) is held until every child job
   * succeeds. Each child has independent retry/backoff configuration so a
   * transient failure in one step is retried without re-running its siblings.
   *
   * Child execution order is determined by BullMQ — children run in parallel
   * by default. If sequential ordering is needed, model them as a chain of
   * parent→child flows instead.
   */
  async triggerSettlementFlow(data: SettlementFlowData): Promise<string> {
    const { tradeId } = data;

    this.logger.log(`Triggering settlement flow for tradeId=${tradeId}`);

    const flow: FlowJob = {
      name: SETTLEMENT_JOBS.PIPELINE,
      queueName: SETTLEMENT_QUEUES.PIPELINE,
      data,
      opts: {
        attempts: 1, // parent re-runs are not useful once children are done
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
      children: [
        {
          name: SETTLEMENT_JOBS.CONFIRM_ON_CHAIN,
          queueName: SETTLEMENT_QUEUES.STEPS,
          data,
          opts: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 2_000 },
            removeOnComplete: true,
            removeOnFail: { count: 20 },
          },
        },
        {
          name: SETTLEMENT_JOBS.UPDATE_BALANCES,
          queueName: SETTLEMENT_QUEUES.STEPS,
          data,
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: true,
            removeOnFail: { count: 20 },
          },
        },
        {
          name: SETTLEMENT_JOBS.RECORD_PNL,
          queueName: SETTLEMENT_QUEUES.STEPS,
          data,
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: true,
            removeOnFail: { count: 20 },
          },
        },
        {
          name: SETTLEMENT_JOBS.NOTIFY_USER,
          queueName: SETTLEMENT_QUEUES.STEPS,
          data,
          opts: {
            attempts: 2,
            backoff: { type: 'fixed', delay: 3_000 },
            removeOnComplete: true,
            removeOnFail: { count: 20 },
          },
        },
      ],
    };

    const { job } = await this.flowProducer.add(flow);
    const jobId = job.id ?? tradeId;

    this.logger.log(
      `Settlement flow enqueued — parentJobId=${jobId} tradeId=${tradeId}`,
    );
    return jobId;
  }
}
