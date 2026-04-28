import { WebhookEventType } from '../entities/webhook.entity';

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  deliveryId: string;
  data: Record<string, unknown>;
}
