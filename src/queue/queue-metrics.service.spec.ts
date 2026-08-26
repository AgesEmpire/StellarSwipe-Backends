import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { QueueMetricsService } from './queue-metrics.service';
import {
  PRIORITY_QUEUE,
  CRITICAL_QUEUE,
  LOW_PRIORITY_QUEUE,
} from './priority-queue.service';

function makeQueue(overrides: Partial<Record<string, any>> = {}) {
  const now = Date.now();
  return {
    getJobCounts: jest
      .fn()
      .mockResolvedValue({
        waiting: 2,
        active: 1,
        completed: 10,
        failed: 1,
        delayed: 0,
      }),
    getWaiting: jest
      .fn()
      .mockResolvedValue([
        { timestamp: now - 5000 },
        { timestamp: now - 2000 },
      ]),
    getCompleted: jest.fn().mockResolvedValue([
      { processedOn: now - 3000, finishedOn: now - 2500 },
      { processedOn: now - 6000, finishedOn: now - 5000 },
    ]),
    getFailed: jest
      .fn()
      .mockResolvedValue([{ attemptsMade: 3 }, { attemptsMade: 2 }]),
    ...overrides,
  };
}

describe('QueueMetricsService', () => {
  let service: QueueMetricsService;
  let normalQueue: ReturnType<typeof makeQueue>;
  let criticalQueue: ReturnType<typeof makeQueue>;
  let lowQueue: ReturnType<typeof makeQueue>;

  beforeEach(async () => {
    normalQueue = makeQueue();
    criticalQueue = makeQueue();
    lowQueue = makeQueue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueMetricsService,
        { provide: getQueueToken(PRIORITY_QUEUE), useValue: normalQueue },
        { provide: getQueueToken(CRITICAL_QUEUE), useValue: criticalQueue },
        { provide: getQueueToken(LOW_PRIORITY_QUEUE), useValue: lowQueue },
      ],
    }).compile();

    service = module.get<QueueMetricsService>(QueueMetricsService);
  });

  it('collects a snapshot across all three tiers', async () => {
    const snapshot = await service.collectSnapshot();

    expect(snapshot.tiers).toHaveProperty('critical');
    expect(snapshot.tiers).toHaveProperty('normal');
    expect(snapshot.tiers).toHaveProperty('low');
    expect(snapshot.snapshotAt).toBeDefined();
  });

  it('reports waiting and active totals', async () => {
    const snapshot = await service.collectSnapshot();
    // Each mock queue returns waiting=2, active=1 → totals = 6, 3
    expect(snapshot.totalWaiting).toBe(6);
    expect(snapshot.totalActive).toBe(3);
    expect(snapshot.totalFailed).toBe(3);
  });

  it('computes oldest waiting job age > 0', async () => {
    const snapshot = await service.collectSnapshot();
    expect(snapshot.tiers.normal.oldestWaitingJobAgeMs).toBeGreaterThan(0);
  });

  it('computes average processing time from completed jobs', async () => {
    const snapshot = await service.collectSnapshot();
    // Job 1: 500ms, Job 2: 1000ms → avg = 750ms
    expect(snapshot.tiers.normal.avgProcessingTimeMs).toBe(750);
  });

  it('sums retries from failed job sample', async () => {
    const snapshot = await service.collectSnapshot();
    // 3 + 2 = 5 retries
    expect(snapshot.tiers.normal.totalRetries).toBe(5);
  });

  it('handles empty queues gracefully', async () => {
    normalQueue.getWaiting.mockResolvedValue([]);
    normalQueue.getCompleted.mockResolvedValue([]);
    normalQueue.getFailed.mockResolvedValue([]);
    normalQueue.getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    });

    const snapshot = await service.collectSnapshot();
    const { normal } = snapshot.tiers;

    expect(normal.oldestWaitingJobAgeMs).toBe(0);
    expect(normal.avgWaitTimeMs).toBe(0);
    expect(normal.avgProcessingTimeMs).toBe(0);
    expect(normal.totalRetries).toBe(0);
  });

  it('tolerates queue API errors gracefully', async () => {
    normalQueue.getWaiting.mockRejectedValue(new Error('Redis down'));
    normalQueue.getCompleted.mockRejectedValue(new Error('Redis down'));
    normalQueue.getFailed.mockRejectedValue(new Error('Redis down'));

    await expect(service.collectSnapshot()).resolves.toBeDefined();
  });
});
