import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Funnel } from '../entities/funnel.entity';
import { FunnelTrackerService } from '../funnel-tracker.service';

@Injectable()
export class AnalyzeFunnelsJob {
  private readonly logger = new Logger(AnalyzeFunnelsJob.name);

  constructor(
    @InjectRepository(Funnel) private readonly funnelRepo: Repository<Funnel>,
    private readonly funnelTrackerService: FunnelTrackerService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async run(): Promise<void> {
    const funnels = await this.funnelRepo.find({ where: { isActive: true } });
    for (const funnel of funnels) {
      try {
        const analysis = await this.funnelTrackerService.analyzeFunnel(funnel.id);
        this.logger.log(
          `Funnel "${funnel.name}" — conversion: ${analysis.overallConversionRate}%`,
        );
      } catch (err) {
        this.logger.error(`Failed to analyze funnel ${funnel.id}`, err);
      }
    }
  }
}
