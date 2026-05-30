import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from './entities/trade.entity';
import { AdvancedOrder } from './entities/advanced-order.entity';
import { TradesController } from './trades.controller';
import { AdvancedOrdersController } from './advanced-orders.controller';
import { LimitOrderController } from './limit-order.controller';
import { LimitOrderService } from './limit-order.service';
import { TradesService } from './trades.service';
import { RiskManagerService } from './services/risk-manager.service';
import { TradeExecutorService } from './services/trade-executor.service';
import { OcoOrderService } from './services/oco-order.service';
import { IcebergOrderService } from './services/iceberg-order.service';
import { StellarConfigService } from '../config/stellar.service';
import { RiskManagerModule } from '../risk/risk-manager.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { SdexModule } from '../sdex/sdex.module';
import { SorobanModule } from '../soroban/soroban.module';
import { Signal } from '../signals/entities/signal.entity';
import { BullModule } from '@nestjs/bull';
import { WebsocketModule } from '../websocket/websocket.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TxMonitorService } from './services/tx-monitor.service';
import { MonitorTransactionsJob } from './jobs/monitor-transactions.job';
import { PartialCloseService } from './partial-close/partial-close.service';
import { TradeHistoryService } from './trade-history.service';
import { TradeOutcomeService } from './trade-outcome.service';
import { TradeAuditService } from './trade-audit.service';
import { TradeAuditController } from './trade-audit.controller';
import { ConfirmationPollingService } from './services/confirmation-polling.service';
import { AuditModule } from '../audit-log/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TradeExecutionOrchestratorService } from './services/trade-execution-orchestrator.service';
import { SwipeController } from './swipe/swipe.controller';
import { SwipeService } from './swipe/swipe.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade, AdvancedOrder, Signal]),
    RiskManagerModule,
    ComplianceModule,
    SdexModule,
    SorobanModule,
    BullModule.registerQueue({
      name: 'transactions',
    }),
    WebsocketModule,
    AuditModule,
    NotificationsModule,
  ],
  controllers: [TradesController, AdvancedOrdersController, LimitOrderController, SwipeController],
  providers: [
    TradesService,
    RiskManagerService,
    TradeExecutorService,
    StellarConfigService,
    TxMonitorService,
    MonitorTransactionsJob,
    OcoOrderService,
    IcebergOrderService,
    PartialCloseService,
    TradeHistoryService,
    TradeOutcomeService,
    LimitOrderService,
    TradeExecutionOrchestratorService,
    SwipeService,
  ],
  exports: [TradesService, RiskManagerService, OcoOrderService, IcebergOrderService, PartialCloseService, TradeHistoryService, TradeOutcomeService, TradeAuditService, ConfirmationPollingService, TradeExecutionOrchestratorService],
})
export class TradesModule { }

