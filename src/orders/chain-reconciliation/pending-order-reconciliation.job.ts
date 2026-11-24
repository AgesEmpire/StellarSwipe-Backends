import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PendingOrderReconciliationService } from './pending-order-reconciliation.service';

@Injectable()
export class PendingOrderReconciliationJob {
  private readonly logger = new Logger(PendingOrderReconciliationJob.name);

  constructor(
    private readonly reconciliation: PendingOrderReconciliationService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async handle(): Promise<void> {
    if (String(this.config.get('ORDER_RECONCILIATION_ENABLED', 'true')) === 'false') return;
    try {
      await this.reconciliation.runIfIdle();
    } catch (error) {
      this.logger.error(`Pending order reconciliation failed: ${(error as Error).message}`);
    }
  }
}
