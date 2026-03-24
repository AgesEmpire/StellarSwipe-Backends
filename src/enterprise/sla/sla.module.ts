import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { SlaAgreement } from './entities/sla-agreement.entity';
import { SlaMetric } from './entities/sla-metric.entity';
import { SlaViolation } from './entities/sla-violation.entity';
import { SlaManagerService } from './sla-manager.service';
import { SlaController } from './sla.controller';
import { UptimeMonitor } from './monitors/uptime-monitor';
import { ResponseTimeMonitor } from './monitors/response-time-monitor';
import { ThroughputMonitor } from './monitors/throughput-monitor';
import { TrackSlaMetricsJob, TRACK_SLA_METRICS_QUEUE } from './jobs/track-sla-metrics.job';
import { GenerateSlaReportsJob, GENERATE_SLA_REPORTS_QUEUE } from './jobs/generate-sla-reports.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([SlaAgreement, SlaMetric, SlaViolation]),
    BullModule.registerQueue(
      { name: TRACK_SLA_METRICS_QUEUE },
      { name: GENERATE_SLA_REPORTS_QUEUE },
    ),
  ],
  providers: [
    SlaManagerService,
    UptimeMonitor,
    ResponseTimeMonitor,
    ThroughputMonitor,
    TrackSlaMetricsJob,
    GenerateSlaReportsJob,
  ],
  controllers: [SlaController],
  exports: [SlaManagerService],
})
export class SlaModule {}
