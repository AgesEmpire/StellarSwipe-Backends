import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { SlaMetric } from './entities/sla-metric.entity';
import { SlaMonitorService } from './sla-monitor.service';
import { SlaReporterService } from './sla-reporter.service';
import { SlaController } from './sla.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SlaMetric]),
    ScheduleModule.forRoot(),
  ],
  controllers: [SlaController],
  providers: [SlaMonitorService, SlaReporterService],
  exports: [SlaMonitorService, SlaReporterService],
})
export class SlaModule {}
