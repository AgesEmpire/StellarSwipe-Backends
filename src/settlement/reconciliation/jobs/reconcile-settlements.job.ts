import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SettlementReconciliationService } from '../settlement-reconciliation.service';

@Injectable()
export class ReconcileSettlementsJob {
  private readonly logger = new Logger(ReconcileSettlementsJob.name);

  constructor(
    private readonly reconciliationService: SettlementReconciliationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyReconciliation(): Promise<void> {
    this.logger.log('Starting daily settlement reconciliation');
    const report = await this.reconciliationService.runDailyReconciliation();
    this.logger.log(
      `Daily reconciliation finished — status: ${report.status}, discrepancies: ${report.discrepancyCount}`,
    );
  }
}
