import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, EntityManager, LessThan } from 'typeorm';
import { ProcessedWebhookEvent } from './processed-webhook-event.entity';

export interface InboundDelivery {
  source: string;
  deliveryId: string;
  /** Unix seconds or ISO string provided by the sender */
  timestamp: number | string;
}

export type ReplayResult<T> =
  | { status: 'processed'; result: T }
  | { status: 'duplicate' };

/** Max accepted clock skew / delivery age (seconds). */
export const WEBHOOK_TOLERANCE_SECONDS = Number(
  process.env.WEBHOOK_TOLERANCE_SECONDS ?? 300,
);

@Injectable()
export class WebhookReplayGuardService {
  private readonly logger = new Logger(WebhookReplayGuardService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  assertFreshTimestamp(timestamp: number | string, now = Date.now()): Date {
    const ts =
      typeof timestamp === 'number' || /^\d+$/.test(String(timestamp))
        ? new Date(Number(timestamp) * 1000)
        : new Date(timestamp);
    if (isNaN(ts.getTime())) throw new BadRequestException('Invalid webhook timestamp');
    if (Math.abs(now - ts.getTime()) > WEBHOOK_TOLERANCE_SECONDS * 1000) {
      throw new BadRequestException('Webhook timestamp outside tolerance window');
    }
    return ts;
  }

  /**
   * Claims the delivery ID and runs the handler in one transaction.
   * Concurrent duplicates block on the unique key; the loser sees 0 inserted
   * rows and is acknowledged as a duplicate. If the handler throws, the claim
   * is rolled back so the sender may retry.
   */
  async processOnce<T>(
    delivery: InboundDelivery,
    handler: (manager: EntityManager) => Promise<T>,
  ): Promise<ReplayResult<T>> {
    const eventTimestamp = this.assertFreshTimestamp(delivery.timestamp);

    return this.dataSource.transaction(async (manager) => {
      const claimed: unknown[] = await manager.query(
        `INSERT INTO processed_webhook_events (source, delivery_id, event_timestamp)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING delivery_id`,
        [delivery.source, delivery.deliveryId, eventTimestamp],
      );

      if (!claimed.length) {
        this.logger.warn(`Duplicate webhook ${delivery.source}:${delivery.deliveryId} acknowledged`);
        return { status: 'duplicate' as const };
      }
      return { status: 'processed' as const, result: await handler(manager) };
    });
  }

  /** Records older than the tolerance window can never be replayed, so prune them. */
  @Cron(CronExpression.EVERY_HOUR)
  async pruneExpired(): Promise<void> {
    const cutoff = new Date(Date.now() - WEBHOOK_TOLERANCE_SECONDS * 2000);
    await this.dataSource
      .getRepository(ProcessedWebhookEvent)
      .delete({ processedAt: LessThan(cutoff) });
  }
}
