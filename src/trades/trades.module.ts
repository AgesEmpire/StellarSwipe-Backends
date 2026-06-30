import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
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
import { ConfirmationPollingService } from './services/confirmation-polling.service';
import { AuditModule } from '../audit-log/audit.module';
import { TradeExecutionOrchestratorService } from './services/trade-execution-orchestrator.service';
import { SwipeController } from './swipe/swipe.controller';
import { SwipeService } from './swipe/swipe.service';
import { MarketOrderService } from './services/market-order.service';
import { MarketOrderController } from './market-order.controller';
import { TradeRetryService } from './services/trade-retry.service';
import { TradeRetryController } from './trade-retry.controller';
import { TradeSagaOrchestrator } from './saga/trade-saga.orchestrator';
import { TradeSagaStepsFactory } from './saga/trade-saga.steps';
import { TradeSagaService } from './saga/trade-saga.service';
import { TradeSagaEntity } from './saga/trade-saga.entity';
import { TRADE_CQRS_HANDLERS } from './cqrs';
import {
  NotificationPreferencesClientService,
  NOTIFICATION_TCP_CLIENT,
} from './services/notification-preferences-client.service';
import { CanaryRoutingModule } from './canary/canary-routing.module';
import { SlippageGuardService } from './services/slippage-guard.service';

@Module({
  imports: [
    CqrsModule,
    TypeOrmModule.forFeature([Trade, AdvancedOrder, Signal, TradeSagaEntity]),
    RiskManagerModule,
    ComplianceModule,
    SdexModule,
    SorobanModule,
    BullModule.registerQueue({ name: 'transactions' }),
    WebsocketModule,
    AuditModule,
    NotificationsModule,
    CanaryRoutingModule,
    ClientsModule.registerAsync([
      {
        name: NOTIFICATION_TCP_CLIENT,
        inject: [ConfigService],
        useFactory: (cfg: ConfigService) => ({
          transport: Transport.TCP,
          options: {
            host: cfg.get<string>('NOTIFICATION_TCP_HOST', 'localhost'),
            port: cfg.get<number>('NOTIFICATION_TCP_PORT', 3001),
          },
        }),
      },
    ]),
  ],
  controllers: [TradesController, AdvancedOrdersController, LimitOrderController, SwipeController, MarketOrderController, TradeRetryController],
  providers: [
    TradesService,
    MarketOrderService,
    BatchOrderService,
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
    TradeRetryService,
    TradeSagaOrchestrator,
    TradeSagaStepsFactory,
    TradeSagaService,
    NotificationPreferencesClientService,
    SlippageGuardService,
    ...TRADE_CQRS_HANDLERS,
  ],
  exports: [
    TradesService,
    RiskManagerService,
    OcoOrderService,
    IcebergOrderService,
    PartialCloseService,
    TradeHistoryService,
    TradeOutcomeService,
    TradeAuditService,
    ConfirmationPollingService,
    TradeExecutionOrchestratorService,
    TradeRetryService,
    TradeExecutorService,
    TradeSagaService,
    NotificationPreferencesClientService,
    SlippageGuardService,
  ],
})
export class TradesModule {}
