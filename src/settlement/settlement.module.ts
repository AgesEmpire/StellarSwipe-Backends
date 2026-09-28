import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementFlowModule } from './flow/settlement-flow.module';
import { SettlementReconciliationService } from './reconciliation/settlement-reconciliation.service';
import { ReconcileSettlementsJob } from './reconciliation/jobs/reconcile-settlements.job';
import { LedgerDriftDetectionJob } from './reconciliation/jobs/ledger-drift-detection.job';
import { Trade } from '../trades/entities/trade.entity';
import { HorizonBulkheadModule } from '../stellar/bulkhead/horizon-bulkhead.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade]),
    SettlementFlowModule,
    HorizonBulkheadModule,
  ],
  providers: [
    SettlementReconciliationService,
    ReconcileSettlementsJob,
    LedgerDriftDetectionJob,
  ],
  exports: [SettlementReconciliationService],
})
export class SettlementModule {}
