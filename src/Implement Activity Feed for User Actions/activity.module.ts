import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Activity } from './entities/activity.entity';
import { ActivityService } from './activity.service';
import { ActivityController } from './activity.controller';
import { ActivityGateway } from './activity.gateway';

@Module({
  imports: [
    TypeOrmModule.forFeature([Activity]),
    ScheduleModule.forRoot(), // if not already registered in AppModule
  ],
  providers: [ActivityService, ActivityGateway],
  controllers: [ActivityController],
  exports: [ActivityService], // export so other modules (trades, swipes) can call log()
})
export class ActivityModule {}
