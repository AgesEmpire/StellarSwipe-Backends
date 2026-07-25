import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Trade } from '../trades/entities/trade.entity';
import { RiskControlsService } from './risk-controls.service';
import { RiskControlsController } from './risk-controls.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { TradesModule } from '../trades/trades.module';
import { PriceService } from '../shared/price.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Trade]),
    ScheduleModule.forRoot(),
    NotificationsModule,
    TradesModule,
  ],
  controllers: [RiskControlsController],
  providers: [RiskControlsService, PriceService],
  exports: [RiskControlsService],
})
export class RiskControlsModule {}
