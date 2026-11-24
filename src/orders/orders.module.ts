import { Module } from '@nestjs/common';
import { ConditionalOrdersModule } from './conditional/conditional-orders.module';
import { OrderChainReconciliationModule } from './chain-reconciliation/order-chain-reconciliation.module';

@Module({
  imports: [ConditionalOrdersModule, OrderChainReconciliationModule],
  exports: [ConditionalOrdersModule, OrderChainReconciliationModule],
})
export class OrdersModule {}
