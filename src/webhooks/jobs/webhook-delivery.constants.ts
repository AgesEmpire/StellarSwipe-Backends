import { JobsOptions } from 'bullmq';

export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';
export const WEBHOOK_DELIVERY_JOB = 'deliver-webhook';
export const WEBHOOK_BACKOFF_STRATEGY = 'webhook-exponential-jitter';
export const WEBHOOK_MAX_ATTEMPTS = 8;
export const WEBHOOK_FAILURE_DISABLE_THRESHOLD = 10;
/** Total request timeout (connect + transfer). Kept intentionally short so stalled workers are released promptly. */
export const WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;
/** Separate connect-phase timeout — fails fast on DNS/TCP issues before consuming the full slot. */
export const WEBHOOK_CONNECT_TIMEOUT_MS = 3_000;
/** Maximum bytes read from the response body before truncation. Guards worker memory from large payloads. */
export const WEBHOOK_MAX_RESPONSE_BYTES = 8_192; // 8 KB
/** Stored response body is capped at this many characters (post-serialization). */
export const WEBHOOK_RESPONSE_BODY_MAX_CHARS = 2_048;
export const WEBHOOK_BACKOFF_BASE_MS = 1000;
export const WEBHOOK_BACKOFF_CAP_MS = 64000;
export const WEBHOOK_BACKOFF_JITTER_MS = 1000;
export const WEBHOOK_PERMANENTLY_FAILED_EVENT = 'WebhookPermanentlyFailed';

/** Classify an axios error for retry-policy decisions. */
export type WebhookFailureKind = 'timeout' | 'network' | 'http' | 'unknown';

export function classifyWebhookFailure(err: unknown): WebhookFailureKind {
  const code = (err as any)?.code as string | undefined;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') return 'timeout';
  if ((err as any)?.response) return 'http';
  if (code) return 'network';
  return 'unknown';
}

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
