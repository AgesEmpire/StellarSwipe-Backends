import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SlaManagerService } from '../sla-manager.service';
import { SlaAgreement, SlaAgreementStatus } from '../entities/sla-agreement.entity';
import { UptimeMonitor } from '../monitors/uptime-monitor';
import { ThroughputMonitor } from '../monitors/throughput-monitor';

export const TRACK_SLA_METRICS_QUEUE = 'track-sla-metrics';

@Processor(TRACK_SLA_METRICS_QUEUE)
export class TrackSlaMetricsJob {
  private readonly logger = new Logger(TrackSlaMetricsJob.name);

  constructor(
    private readonly slaManager: SlaManagerService,
    private readonly uptimeMonitor: UptimeMonitor,
    private readonly throughputMonitor: ThroughputMonitor,
    @InjectRepository(SlaAgreement)
    private readonly agreementRepo: Repository<SlaAgreement>,
  ) {}

  @Process('check-all')
  async handleCheckAll(): Promise<{ checked: number; violations: number }> {
    const agreements = await this.agreementRepo.find({
      where: { status: SlaAgreementStatus.ACTIVE },
    });

    let totalViolations = 0;

    for (const agreement of agreements) {
      try {
        const alerts = await this.slaManager.checkAndRecordViolations(agreement.id);
        totalViolations += alerts.length;
      } catch (err) {
        this.logger.error(`Failed to check SLA for ${agreement.id}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`SLA check complete: ${agreements.length} agreements, ${totalViolations} violations`);
    return { checked: agreements.length, violations: totalViolations };
  }

  @Process('record-uptime')
  async handleRecordUptime(job: Job<{ agreementId: string; isUp: boolean }>): Promise<void> {
    await this.uptimeMonitor.record(job.data.agreementId, job.data.isUp, 1);
  }

  @Process('record-throughput')
  async handleRecordThroughput(
    job: Job<{ agreementId: string; rpm: number; errorRatePercent: number; sampleCount: number }>,
  ): Promise<void> {
    const { agreementId, rpm, errorRatePercent, sampleCount } = job.data;
    await this.throughputMonitor.record(agreementId, rpm, errorRatePercent, sampleCount);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error): void {
    this.logger.error(`Job ${job.id} (${job.name}) failed: ${error.message}`);
  }
}
