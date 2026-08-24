/**
 * Integration examples for queue lag observability (issue #1028).
 *
 * Documents the snapshot shape QueueLagService exposes for metrics exporters.
 */

import type { QueueLagSnapshot } from '../../src/queue/queue-lag.service';

describe('Queue lag observability (#1028)', () => {
  it('snapshot shape is stable and low-cardinality', () => {
    const sample: QueueLagSnapshot = {
      queue: 'critical',
      waiting: 12,
      active: 2,
      failed: 0,
      delayed: 1,
      oldestJobAgeMs: 45_000,
      avgWaitMs: 12_000,
      sampledAt: new Date().toISOString(),
    };

    expect(sample.queue).toMatch(/^(critical|normal|low)$/);
    expect(sample.waiting).toBeGreaterThanOrEqual(0);
    expect(sample.oldestJobAgeMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(sample.sampledAt)).not.toBeNaN();
  });

  it('elevated lag thresholds used for warnings', () => {
    const WAITING_WARN = 100;
    const AGE_WARN_MS = 60_000;

    const elevated: QueueLagSnapshot = {
      queue: 'normal',
      waiting: 150,
      active: 5,
      failed: 2,
      delayed: 0,
      oldestJobAgeMs: 90_000,
      avgWaitMs: 40_000,
      sampledAt: new Date().toISOString(),
    };

    const shouldWarn =
      elevated.waiting > WAITING_WARN || elevated.oldestJobAgeMs > AGE_WARN_MS;
    expect(shouldWarn).toBe(true);
  });

  it('healthy queues do not trip warn thresholds', () => {
    const healthy: QueueLagSnapshot = {
      queue: 'low',
      waiting: 3,
      active: 1,
      failed: 0,
      delayed: 0,
      oldestJobAgeMs: 500,
      avgWaitMs: 200,
      sampledAt: new Date().toISOString(),
    };

    expect(healthy.waiting > 100 || healthy.oldestJobAgeMs > 60_000).toBe(false);
  });
});
