import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleManagerService } from './schedule-manager.service';
import { MarketSchedule } from './entities/market-schedule.entity';

@Module({
  imports: [TypeOrmModule.forFeature([MarketSchedule])],
  providers: [ScheduleManagerService],
  exports: [ScheduleManagerService],
})
export class MarketScheduleModule {}
