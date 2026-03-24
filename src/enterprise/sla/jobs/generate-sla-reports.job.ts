import { Processor, Process, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SlaManagerService } from '../sla-manager.service';
import { SlaAgreement, SlaAgreementStatus } from '../entities/sla-agreement.entity';

export const GENERATE_SLA_REPORTS_QUEUE = 'generate-sla-reports';

@Processor(GENERATE_SLA_REPORTS_QUEUE)
export class GenerateSlaReportsJob {
  private readonly logger = new Logger(GenerateSlaReportsJob.name);

  constructor(
    private readonly slaManager: SlaManagerService,
    @InjectRepository(SlaAgreement)
    private readonly agreementRepo: Repository<SlaAgreement>,
  ) {}

  @Process('generate-monthly')
  async handleGenerateMonthly(job: Job<{ year: number; month: number }>): Promise<{ generated: number; errors: number }> {
    const { year, month } = job.data;
    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 1);

    const agreements = await this.agreementRepo.find({
      where: { status: SlaAgreementStatus.ACTIVE },
    });

    let generated = 0;
    let errors = 0;

    for (const agreement of agreements) {
      try {
        const report = await this.slaManager.generateReport(agreement.id, periodStart, periodEnd);
        this.logger.log(
          `Monthly SLA report for ${agreement.clientName} (${year}-${month}): compliant=${report.slaCompliant}, violations=${report.totalViolations}`,
        );
        generated++;
      } catch (err) {
        this.logger.error(`Failed to generate report for ${agreement.id}: ${(err as Error).message}`);
        errors++;
      }
    }

    return { generated, errors };
  }

  @Process('generate-for-agreement')
  async handleGenerateForAgreement(
    job: Job<{ agreementId: string; periodStart: string; periodEnd: string }>,
  ) {
    const { agreementId, periodStart, periodEnd } = job.data;
    return this.slaManager.generateReport(agreementId, new Date(periodStart), new Date(periodEnd));
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error): void {
    this.logger.error(`Job ${job.id} (${job.name}) failed: ${error.message}`);
  }
}
