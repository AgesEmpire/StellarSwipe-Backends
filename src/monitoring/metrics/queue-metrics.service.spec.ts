import { Registry } from 'prom-client';
import { QueueMetricsService } from './queue-metrics.service';
import { PrometheusService } from './prometheus.service';
import { Queue } from 'bull';

function buildQueue(overrides: Partial<Record<string, () => Promise<number>>> = {}): Queue {
  return {
    getWaitingCount: jest.fn().mockResolvedValue(overrides['getWaitingCount'] ? overrides['getWaitingCount']() : Promise.resolve(3)),
    getActiveCount: jest.fn().mockResolvedValue(overrides['getActiveCount'] ? overrides['getActiveCount']() : Promise.resolve(1)),
    getCompletedCount: jest.fn().mockResolvedValue(overrides['getCompletedCount'] ? overrides['getCompletedCount']() : Promise.resolve(100)),
    getFailedCount: jest.fn().mockResolvedValue(overrides['getFailedCount'] ? overrides['getFailedCount']() : Promise.resolve(2)),
    getDelayedCount: jest.fn().mockResolvedValue(overrides['getDelayedCount'] ? overrides['getDelayedCount']() : Promise.resolve(0)),
  } as unknown as Queue;
}

function buildService(queue?: Queue): { svc: QueueMetricsService; registry: Registry } {
  const registry = new Registry();
  const prometheus = { registry } as unknown as PrometheusService;
  const txQueue = queue ?? buildQueue();

  const svc = new QueueMetricsService(prometheus, txQueue);
  return { svc, registry };
}

describe('QueueMetricsService', () => {
  afterEach(() => jest.clearAllMocks());

  it('registers Prometheus gauges on init', async () => {
    const { svc, registry } = buildService();
    svc.onModuleInit();
    await new Promise((r) => setImmediate(r)); // let collectAll settle

    const metrics = await registry.metrics();
    expect(metrics).toContain('bull_queue_jobs_waiting');
    expect(metrics).toContain('bull_queue_jobs_active');
    expect(metrics).toContain('bull_queue_jobs_completed');
    expect(metrics).toContain('bull_queue_jobs_failed');
    expect(metrics).toContain('bull_queue_jobs_delayed');

    svc.onModuleDestroy();
  });

  it('sets gauge values from queue counts', async () => {
    const { svc, registry } = buildService();
    svc.onModuleInit();
    await new Promise((r) => setImmediate(r));

    const metrics = await registry.metrics();
    // waiting = 3
    expect(metrics).toMatch(/bull_queue_jobs_waiting\{queue="transactions"\}\s+3/);
    // active = 1
    expect(metrics).toMatch(/bull_queue_jobs_active\{queue="transactions"\}\s+1/);

    svc.onModuleDestroy();
  });

  it('handles queue errors gracefully (does not throw)', async () => {
    const failingQueue = {
      getWaitingCount: jest.fn().mockRejectedValue(new Error('redis down')),
      getActiveCount: jest.fn().mockRejectedValue(new Error('redis down')),
      getCompletedCount: jest.fn().mockRejectedValue(new Error('redis down')),
      getFailedCount: jest.fn().mockRejectedValue(new Error('redis down')),
      getDelayedCount: jest.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as Queue;

    const { svc } = buildService(failingQueue);
    expect(() => svc.onModuleInit()).not.toThrow();
    await new Promise((r) => setImmediate(r));

    svc.onModuleDestroy();
  });

  it('clears the poll timer on destroy', () => {
    const { svc } = buildService();
    svc.onModuleInit();
    expect(() => svc.onModuleDestroy()).not.toThrow();
  });
});
