import { registerAs } from '@nestjs/config';

/**
 * #944 — Configurable retry policy for the shared priority/critical/low-priority
 * Bull queues (see `PriorityQueueService.addJob`).
 *
 * Lets operators tune the default number of attempts and the exponential
 * backoff delay via environment variables, without a code change/redeploy.
 * Defaults match the values that were previously hardcoded in
 * `PriorityQueueService.addJob()` (attempts: 3, backoff: exponential/2000ms).
 *
 * Per-call `options` passed to `addJob()` still take precedence over these
 * defaults.
 */
export const queueRetryConfig = registerAs('queueRetry', () => ({
  attempts: parseInt(process.env.QUEUE_RETRY_ATTEMPTS || '3', 10),
  backoffType: (process.env.QUEUE_RETRY_BACKOFF_TYPE || 'exponential') as
    | 'fixed'
    | 'exponential',
  backoffDelay: parseInt(process.env.QUEUE_RETRY_BACKOFF_DELAY_MS || '2000', 10),
}));

export interface QueueRetryConfig {
  attempts: number;
  backoffType: 'fixed' | 'exponential';
  backoffDelay: number;
}
