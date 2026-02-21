import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Position } from '../entities/position.entity';
import { Order } from '../entities/order.entity';
import { StopLossService } from './services/stop-loss.service';
import { TakeProfitService } from './services/take-profit.service';
import { TrailingStopService } from './services/trailing-stop.service';
import { PriceService } from './services/price.service';
import { MonitorPositionsJob } from './jobs/monitor-positions.job';
import { TradeNotificationListener } from './listeners/trade-notification.listener';
import { TradesController } from './trades.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Position, Order]),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    NotificationsModule,
  ],
  controllers: [TradesController],
  providers: [
    StopLossService,
    TakeProfitService,
    TrailingStopService,
    PriceService,
    MonitorPositionsJob,
    TradeNotificationListener,
  ],
  exports: [StopLossService, TakeProfitService, TrailingStopService],
})
export class TradesModule {}
