/**
 * Webhook Handler Interface
 * Defines the contract for handling webhooks from payment providers
 */

export enum WebhookEventType {
  PAYMENT_SUCCESS = 'payment.success',
  PAYMENT_FAILED = 'payment.failed',
  PAYMENT_CANCELLED = 'payment.cancelled',
  REFUND_COMPLETED = 'refund.completed',
  REFUND_FAILED = 'refund.failed',
  PAYMENT_DISPUTE = 'payment.dispute',
  PAYMENT_CHARGEBACK = 'payment.chargeback',
  SUBSCRIPTION_CREATED = 'subscription.created',
  SUBSCRIPTION_UPDATED = 'subscription.updated',
  SUBSCRIPTION_CANCELLED = 'subscription.cancelled',
  SUBSCRIPTION_RENEWED = 'subscription.renewed',
}

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  timestamp: Date;
  data: Record<string, any>;
  source: string; // 'stripe', 'paypal', etc.
}

export interface WebhookHandler {
  /**
   * Handle webhook event
   */
  handle(event: WebhookEvent): Promise<void>;

  /**
   * Get event types this handler processes
   */
  getEventTypes(): WebhookEventType[];

  /**
   * Validate webhook authenticity
   */
  validateSignature(payload: string, signature: string): boolean;
}
