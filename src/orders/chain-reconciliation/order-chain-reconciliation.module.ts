import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from '../../trades/entities/trade.entity';
import { OutboxModule } from '../../events/outbox/outbox.module';
import { StellarConfigService } from '../../config/stellar.service';
import { OrderReconciliationEvidence, OrderReconciliationReview } from './order-reconciliation.entity';
import { CHAIN_CONFIRMATION_SOURCE } from './chain-confirmation.source';
import { HorizonChainConfirmationSource } from './horizon-chain-confirmation.source';
import { PendingOrderReconciliationService } from './pending-order-reconciliation.service';
import { PendingOrderReconciliationJob } from './pending-order-reconciliation.job';
import { OrderReconciliationController } from './order-reconciliation.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade, OrderReconciliationEvidence, OrderReconciliationReview]),
    ConfigModule,
    OutboxModule,
  ],
  controllers: [OrderReconciliationController],
  providers: [
    StellarConfigService,
    { provide: CHAIN_CONFIRMATION_SOURCE, useClass: HorizonChainConfirmationSource },
    PendingOrderReconciliationService,
    PendingOrderReconciliationJob,
  ],
  exports: [PendingOrderReconciliationService],
})
export class OrderChainReconciliationModule {}
