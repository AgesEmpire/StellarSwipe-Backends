import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { Notification } from '../entities/notification.entity';
import { NotificationProviderReceipt } from '../entities/notification-provider-receipt.entity';
import { canTransition, ProviderReceiptEvent } from './provider-receipts';

export type ReceiptOutcome = 'applied' | 'ignored' | 'duplicate' | 'unknown';

@Injectable()
export class NotificationReceiptService {
  private readonly logger = new Logger(NotificationReceiptService.name);

  constructor(
    @InjectRepository(NotificationProviderReceipt)
    private readonly receiptRepository: Repository<NotificationProviderReceipt>,
  ) {}

  /**
   * Records each receipt once (deduped on provider + event id) and applies its
   * delivery state to the matching notification when the transition is allowed.
   * Each event runs in its own transaction, so a failure leaves no partial state.
   */
  async ingest(provider: string, events: ProviderReceiptEvent[]): Promise<ReceiptOutcome[]> {
    const outcomes: ReceiptOutcome[] = [];
    for (const event of events) {
      outcomes.push(await this.ingestOne(provider, event));
    }
    return outcomes;
  }

  private ingestOne(provider: string, event: ProviderReceiptEvent): Promise<ReceiptOutcome> {
    return this.receiptRepository.manager.transaction(async (manager): Promise<ReceiptOutcome> => {
      const next = event.deliveryState;
      // Locking the notification serialises concurrent receipts for the same message.
      const target = event.messageId
        ? await manager.findOne(Notification, {
            where: { externalMessageId: event.messageId },
            lock: { mode: 'pessimistic_write' },
          })
        : null;
      const applies = target !== null && next !== null && canTransition(target.deliveryState ?? null, next);

      const id = randomUUID();
      await manager
        .createQueryBuilder()
        .insert()
        .into(NotificationProviderReceipt)
        .values({
          id,
          provider,
          eventId: event.eventId,
          externalMessageId: event.messageId,
          notificationId: target?.id ?? null,
          providerStatus: event.providerStatus,
          deliveryState: next,
          applied: applies,
          reason: event.reason,
          occurredAt: event.occurredAt,
        })
        .orIgnore()
        .execute();

      // ON CONFLICT DO NOTHING leaves no row for us; if the stored row isn't ours, this event was seen before.
      const stored = await manager.findOne(NotificationProviderReceipt, {
        where: { provider, eventId: event.eventId },
      });
      if (!stored || stored.id !== id) {
        return 'duplicate';
      }

      if (!target) {
        this.logger.warn(`Receipt ${provider}:${event.eventId} matches no notification (message ${event.messageId ?? 'none'})`);
        return 'unknown';
      }
      if (!applies) {
        return 'ignored';
      }

      target.deliveryState = next;
      await manager.save(target);
      this.logger.log(`Notification ${target.id} delivery state -> ${next} via ${provider}`);
      return 'applied';
    });
  }
}
