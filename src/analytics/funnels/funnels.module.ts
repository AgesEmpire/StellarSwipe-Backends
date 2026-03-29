import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Funnel } from './entities/funnel.entity';
import { FunnelStep } from './entities/funnel-step.entity';
import { UserFunnelProgress } from './entities/user-funnel-progress.entity';
import { FunnelTrackerService } from './funnel-tracker.service';
import { FunnelController } from './funnel.controller';
import { AnalyzeFunnelsJob } from './jobs/analyze-funnels.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([Funnel, FunnelStep, UserFunnelProgress]),
    ScheduleModule.forRoot(),
  ],
  controllers: [FunnelController],
  providers: [FunnelTrackerService, AnalyzeFunnelsJob],
  exports: [FunnelTrackerService],
})
export class FunnelsModule {}
