import { JobsOptions } from 'bullmq';

export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';
export const WEBHOOK_DELIVERY_JOB = 'deliver-webhook';
export const WEBHOOK_BACKOFF_STRATEGY = 'webhook-exponential-jitter';
export const WEBHOOK_MAX_ATTEMPTS = 8;
export const WEBHOOK_FAILURE_DISABLE_THRESHOLD = 10;

/** Total request timeout (connect + TTFB + body) — issue #1031 */
export const WEBHOOK_REQUEST_TIMEOUT_MS = 5_000;

/** Max response body bytes to buffer / persist — issue #1031 */
export const WEBHOOK_MAX_RESPONSE_BYTES = 64 * 1024; // 64 KiB

/** Max characters stored on the delivery record after truncation */
export const WEBHOOK_PERSISTED_RESPONSE_CHARS = 1_000;

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

/** Classify delivery failure for metrics / retry policy (issue #1031). */
export type WebhookFailureClass =
  | 'timeout'
  | 'network'
  | 'http'
  | 'response_too_large'
  | 'unknown';

export function classifyWebhookError(err: {
  code?: string;
  message?: string;
  response?: { status?: number };
}): WebhookFailureClass {
  const code = err.code ?? '';
  const msg = (err.message ?? '').toLowerCase();

  if (
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    msg.includes('timeout')
  ) {
    return 'timeout';
  }
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'EAI_AGAIN'
  ) {
    return 'network';
  }
  if (msg.includes('max content length') || msg.includes('maxbodylength')) {
    return 'response_too_large';
  }
  if (err.response?.status) {
    return 'http';
  }
  return 'unknown';
}
