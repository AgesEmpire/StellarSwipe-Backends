import { registerAs } from '@nestjs/config';
import {
  CRITICAL_QUEUE,
  LOW_PRIORITY_QUEUE,
  PRIORITY_QUEUE,
} from './priority-queue.service';

/**
 * #1228 — Worker concurrency ceilings per queue workload category.
 *
 *  - `latencySensitive` — customer-facing work on the critical and shared
 *    priority queues (order execution, stop-loss triggers, limit checks).
 *  - `background` — deferrable work on the low-priority queue (analytics,
 *    leaderboard updates).
 *
 * Each category has its own ceiling and its own workers, so a flood of
 * background jobs can never occupy the slots latency-sensitive jobs need
 * (and vice versa).
 */
export enum QueueCategory {
  LATENCY_SENSITIVE = 'latencySensitive',
  BACKGROUND = 'background',
}

export const QUEUE_CATEGORY_QUEUES: Record<QueueCategory, string[]> = {
  [QueueCategory.LATENCY_SENSITIVE]: [CRITICAL_QUEUE, PRIORITY_QUEUE],
  [QueueCategory.BACKGROUND]: [LOW_PRIORITY_QUEUE],
};

export type QueueConcurrencyConfig = Record<QueueCategory, number>;

export const DEFAULT_QUEUE_CONCURRENCY: QueueConcurrencyConfig = {
  [QueueCategory.LATENCY_SENSITIVE]: 10,
  [QueueCategory.BACKGROUND]: 2,
};

function readConcurrency(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be an integer >= 1 (got "${raw}")`);
  }
  return value;
}

export const queueConcurrencyConfig = registerAs(
  'queueConcurrency',
  (): QueueConcurrencyConfig => ({
    [QueueCategory.LATENCY_SENSITIVE]: readConcurrency(
      'QUEUE_CONCURRENCY_LATENCY_SENSITIVE',
      DEFAULT_QUEUE_CONCURRENCY[QueueCategory.LATENCY_SENSITIVE],
    ),
    [QueueCategory.BACKGROUND]: readConcurrency(
      'QUEUE_CONCURRENCY_BACKGROUND',
      DEFAULT_QUEUE_CONCURRENCY[QueueCategory.BACKGROUND],
    ),
  }),
);
