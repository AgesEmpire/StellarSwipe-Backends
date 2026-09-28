import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SETTLEMENT_QUEUES } from './settlement-flow.constants';
import {
  SETTLEMENT_FLOW_PRODUCER,
  SettlementFlowService,
} from './settlement-flow.service';
import { ConfirmOnChainProcessor } from './jobs/confirm-on-chain.processor';
import { UpdateBalancesProcessor } from './jobs/update-balances.processor';
import { RecordPnlProcessor } from './jobs/record-pnl.processor';
import { NotifyUserProcessor } from './jobs/notify-user.processor';
import { SettlementPipelineProcessor } from './jobs/settlement-pipeline.processor';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: SETTLEMENT_QUEUES.PIPELINE },
      { name: SETTLEMENT_QUEUES.STEPS },
    ),
    BullModule.registerFlowProducer({ name: SETTLEMENT_FLOW_PRODUCER }),
  ],
  providers: [
    SettlementFlowService,
    SettlementPipelineProcessor,
    ConfirmOnChainProcessor,
    UpdateBalancesProcessor,
    RecordPnlProcessor,
    NotifyUserProcessor,
  ],
  exports: [SettlementFlowService],
})
export class SettlementFlowModule {}
