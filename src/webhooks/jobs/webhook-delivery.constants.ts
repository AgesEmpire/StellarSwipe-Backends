import { JobsOptions } from 'bullmq';

export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';
export const WEBHOOK_DELIVERY_JOB = 'deliver-webhook';
export const WEBHOOK_BACKOFF_STRATEGY = 'webhook-exponential-jitter';
export const WEBHOOK_MAX_ATTEMPTS = 8;
export const WEBHOOK_FAILURE_DISABLE_THRESHOLD = 10;
export const WEBHOOK_REQUEST_TIMEOUT_MS = 5000;
export const WEBHOOK_BACKOFF_BASE_MS = 1000;
export const WEBHOOK_BACKOFF_CAP_MS = 64000;
export const WEBHOOK_BACKOFF_JITTER_MS = 1000;
export const WEBHOOK_PERMANENTLY_FAILED_EVENT = 'WebhookPermanentlyFailed';

export interface WebhookDeliveryJobData {
  deliveryId: string;
  manualRetry?: boolean;
}

export interface WebhookPermanentlyFailedEvent {
  webhookId: string;
  deliveryId: string;
  userId: string;
  url: string;
  eventType: string;
  eventId: string;
  attempts: number;
  consecutiveFailures: number;
  disabled: boolean;
  error: string;
  occurredAt: Date;
}

export const WEBHOOK_DELIVERY_JOB_OPTIONS: JobsOptions = {
  attempts: WEBHOOK_MAX_ATTEMPTS,
  backoff: {
    type: WEBHOOK_BACKOFF_STRATEGY,
  },
  removeOnComplete: {
    count: 1000,
  },
  removeOnFail: {
    count: 1000,
  },
};

export function calculateWebhookBackoffDelay(
  attempt: number,
  jitterMs = randomWebhookJitter(),
): number {
  const flooredAttempt = Math.floor(attempt);
  const normalizedAttempt = Number.isFinite(flooredAttempt)
    ? Math.max(1, flooredAttempt)
    : 1;
  const cappedExponentialDelay = Math.min(
    Math.pow(2, normalizedAttempt) * WEBHOOK_BACKOFF_BASE_MS,
    WEBHOOK_BACKOFF_CAP_MS,
  );

  return cappedExponentialDelay + clampJitter(jitterMs);
}

export function webhookDeliveryBackoffStrategy(attemptsMade: number): number {
  return calculateWebhookBackoffDelay(attemptsMade);
}

function randomWebhookJitter(): number {
  return Math.floor(Math.random() * WEBHOOK_BACKOFF_JITTER_MS);
}

function clampJitter(jitterMs: number): number {
  if (!Number.isFinite(jitterMs)) return 0;
  return Math.max(0, Math.min(Math.floor(jitterMs), WEBHOOK_BACKOFF_JITTER_MS));
}
