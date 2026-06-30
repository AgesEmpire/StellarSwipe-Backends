import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxPublisherService {
  private readonly logger = new Logger(OutboxPublisherService.name);

  constructor(private readonly outboxService: OutboxService) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async handlePendingEvents(): Promise<void> {
    try {
      await this.outboxService.publishPending();
    } catch (error) {
      this.logger.error(
        'Outbox publisher failed to process pending events',
        (error as Error).stack,
      );
    }
  }
}
