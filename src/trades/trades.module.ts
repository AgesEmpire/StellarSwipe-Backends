import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from './entities/trade.entity';
import { AdvancedOrder } from './entities/advanced-order.entity';
import { TradesController } from './trades.controller';
import { AdvancedOrdersController } from './advanced-orders.controller';
import { TradesService } from './trades.service';
import { RiskManagerService } from './services/risk-manager.service';
import { TradeExecutorService } from './services/trade-executor.service';
import { OcoOrderService } from './services/oco-order.service';
import { IcebergOrderService } from './services/iceberg-order.service';
import { StellarConfigService } from '../config/stellar.service';
import { RiskManagerModule } from '../risk/risk-manager.module';
import { BullModule } from '@nestjs/bull';
import { WebsocketModule } from '../websocket/websocket.module';
import { TxMonitorService } from './services/tx-monitor.service';
import { MonitorTransactionsJob } from './jobs/monitor-transactions.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade, AdvancedOrder]),
    RiskManagerModule,
    BullModule.registerQueue({
      name: 'transactions',
    }),
    WebsocketModule,
  ],
  controllers: [TradesController, AdvancedOrdersController],
  providers: [
    TradesService,
    RiskManagerService,
    TradeExecutorService,
    StellarConfigService,
    TxMonitorService,
    MonitorTransactionsJob,
    OcoOrderService,
    IcebergOrderService,
  ],
  exports: [TradesService, RiskManagerService, OcoOrderService, IcebergOrderService],
})
export class TradesModule { }

