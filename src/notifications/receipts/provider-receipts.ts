import { BadRequestException } from '@nestjs/common';
import { NotificationDeliveryState } from '../entities/notification.entity';

export interface ProviderReceiptEvent {
  eventId: string;
  /** Provider message id used to find the notification; null when the event carries none. */
  messageId: string | null;
  providerStatus: string;
  /** Null when the provider status has no internal mapping; such receipts are stored but never applied. */
  deliveryState: NotificationDeliveryState | null;
  occurredAt: Date | null;
  reason: string | null;
}

const { ACCEPTED, DELIVERED, BOUNCED, INVALID } = NotificationDeliveryState;

// A Map, not an object: provider status text is untrusted and must not reach Object.prototype keys.
const SENDGRID_STATUS_MAP = new Map<string, NotificationDeliveryState>([
  ['processed', ACCEPTED],
  ['deferred', ACCEPTED],
  ['delivered', DELIVERED],
  ['bounce', BOUNCED],
  ['blocked', BOUNCED],
  ['dropped', INVALID],
]);

/**
 * Allowed next states, keyed by current state ('none' = no receipt applied yet).
 * Failure states are terminal, and success never overrides a failure, so an
 * out-of-order "accepted" or "delivered" arriving late is recorded but ignored.
 */
const ALLOWED_TRANSITIONS: Record<string, NotificationDeliveryState[]> = {
  none: [ACCEPTED, DELIVERED, BOUNCED, INVALID],
  [ACCEPTED]: [DELIVERED, BOUNCED, INVALID],
  [DELIVERED]: [BOUNCED, INVALID],
  [BOUNCED]: [],
  [INVALID]: [],
};

export function canTransition(
  from: NotificationDeliveryState | null,
  to: NotificationDeliveryState,
): boolean {
  return ALLOWED_TRANSITIONS[from ?? 'none'].includes(to);
}

/** Parses a SendGrid Event Webhook payload (an array of events) into normalized receipts. */
export function parseSendGridEvents(body: unknown): ProviderReceiptEvent[] {
  if (!Array.isArray(body)) {
    throw new BadRequestException('Expected an array of SendGrid events');
  }

  return body.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      throw new BadRequestException('Malformed receipt event');
    }
    const event = raw as Record<string, unknown>;
    const { sg_event_id: eventId, event: providerStatus, sg_message_id: sgMessageId } = event;
    if (typeof eventId !== 'string' || !eventId || typeof providerStatus !== 'string' || !providerStatus) {
      throw new BadRequestException('Receipt event is missing sg_event_id or event');
    }

    // SendGrid appends a filter suffix ("<id>.filterNNNN...") that the send-time x-message-id header omits.
    const messageId = typeof sgMessageId === 'string' && sgMessageId ? sgMessageId.split('.')[0] : null;

    return {
      eventId,
      messageId,
      providerStatus,
      deliveryState: SENDGRID_STATUS_MAP.get(providerStatus) ?? null,
      occurredAt: typeof event.timestamp === 'number' ? new Date(event.timestamp * 1000) : null,
      reason: typeof event.reason === 'string' ? event.reason : null,
    };
  });
}
