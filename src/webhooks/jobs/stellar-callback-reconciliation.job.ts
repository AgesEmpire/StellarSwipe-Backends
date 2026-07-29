import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, LessThanOrEqual, IsNull, Or } from 'typeorm';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { WebhookSenderService } from '../services/webhook-sender.service';

/** Maximum total delivery attempts before a record is abandoned by the reconciler. */
export const MAX_RECONCILE_ATTEMPTS = 10;

/** Deliveries stuck in 'pending' for longer than this are treated as stale. */
const STALE_PENDING_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

/** Upper bound on records processed per reconciliation run to prevent runaway batches. */
const BATCH_SIZE = 100;

@Injectable()
export class StellarCallbackReconciliationJob {
  private readonly logger = new Logger(StellarCallbackReconciliationJob.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    private readonly senderService: WebhookSenderService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcile(): Promise<void> {
    this.logger.log('Starting Stellar callback reconciliation run');
    const now = new Date();

    const candidates = await this.findCandidates(now);

    if (candidates.length === 0) {
      this.logger.debug('No failed or stale deliveries to reconcile');
      return;
    }

    this.logger.log(
      `Found ${candidates.length} delivery candidate(s) for reconciliation`,
    );

    let retried = 0;
    let succeeded = 0;
    let skipped = 0;

    for (const delivery of candidates) {
      // Idempotency guard: skip if another record for the same logical event already succeeded.
      const alreadyDelivered = await this.deliveryRepo.findOne({
        where: { eventId: delivery.eventId, status: 'success' },
      });

      if (alreadyDelivered) {
        this.logger.log(
          `Skipping duplicate: eventId=${delivery.eventId} already delivered as delivery=${alreadyDelivered.id}`,
        );
        delivery.errorMessage = `Superseded by successful delivery ${alreadyDelivered.id}`;
        delivery.nextRetryAt = undefined;
        await this.deliveryRepo.save(delivery);
        skipped++;
        continue;
      }

      retried++;
      try {
        const success = await this.senderService.retryInPlace(delivery);
        if (success) succeeded++;
      } catch (err) {
        this.logger.warn(
          `Unexpected error retrying delivery=${delivery.id}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Reconciliation complete — retried: ${retried}, succeeded: ${succeeded}, skipped (duplicate): ${skipped}, total candidates: ${candidates.length}`,
    );
  }

  private async findCandidates(now: Date): Promise<WebhookDelivery[]> {
    const staleThreshold = new Date(now.getTime() - STALE_PENDING_THRESHOLD_MS);

    return this.deliveryRepo
      .createQueryBuilder('d')
      .leftJoinAndSelect('d.webhook', 'webhook')
      .where(
        `(
          (d.status = 'failed'  AND d.attempts < :maxAttempts AND (d.next_retry_at IS NULL OR d.next_retry_at <= :now))
          OR
          (d.status = 'pending' AND d.created_at < :stale)
        )`,
        {
          maxAttempts: MAX_RECONCILE_ATTEMPTS,
          now,
          stale: staleThreshold,
        },
      )
      .andWhere('webhook.active = true')
      .orderBy('d.created_at', 'ASC')
      .take(BATCH_SIZE)
      .getMany();
  }
}
