import { registerAs } from '@nestjs/config';

/**
 * Configurable thresholds for the priority-queue backpressure and
 * starvation-prevention strategy (see `QueueBackpressureService`).
 *
 *  - `pressureThreshold` — combined waiting-job count across the critical +
 *    normal queues above which low-priority work should be deferred so it
 *    doesn't compete with customer-facing traffic during a spike.
 *  - `starvationAgeMs` — how long a low-priority job may sit in the waiting
 *    state before it gets promoted to the shared priority queue at HIGH
 *    priority, guaranteeing it eventually runs instead of being starved
 *    indefinitely by a constant stream of higher-priority work.
 *  - `starvationScanBatchSize` — max number of waiting low-priority jobs
 *    inspected per sweep, to bound the cost of the periodic check.
 */
export const queuePressureConfig = registerAs('queuePressure', () => ({
  pressureThreshold: parseInt(process.env.QUEUE_PRESSURE_THRESHOLD || '500', 10),
  starvationAgeMs: parseInt(process.env.QUEUE_STARVATION_AGE_MS || String(5 * 60 * 1000), 10),
  starvationScanBatchSize: parseInt(process.env.QUEUE_STARVATION_SCAN_BATCH || '100', 10),
}));

export interface QueuePressureConfig {
  pressureThreshold: number;
  starvationAgeMs: number;
  starvationScanBatchSize: number;
}
