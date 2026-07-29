import { Test } from '@nestjs/testing';
import { BullMQHealthIndicator, BullMQQueueConfig } from './bullmq.health';

describe('BullMQHealthIndicator', () => {
  let indicator: BullMQHealthIndicator;
  let mockQueue: any;

  beforeEach(async () => {
    mockQueue = {
      getJobCounts: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        {
          provide: 'BULLMQ_QUEUES',
          useValue: [
            {
              queue: mockQueue,
              name: 'notifications',
              backlogThreshold: 1000,
              sustainMs: 60000,
            } as BullMQQueueConfig,
          ],
        },
        BullMQHealthIndicator,
      ],
    }).compile();

    indicator = module.get<BullMQHealthIndicator>(BullMQHealthIndicator);
  });

  it('should report healthy when backlog is below threshold', async () => {
    mockQueue.getJobCounts.mockResolvedValue({
      wait: 500,
      delayed: 200,
      active: 10,
      completed: 5000,
      failed: 0,
    });

    const result = await indicator.isHealthy('bullmq');

    expect(result.status).toBe('up');
    expect(result.details.queues.notifications.healthy).toBe(true);
    expect(result.details.queues.notifications.backlog).toBe(700);
  });

  it('should report unhealthy when backlog exceeds threshold for sustained period', async () => {
    mockQueue.getJobCounts.mockResolvedValue({
      wait: 1500,
      delayed: 500,
      active: 10,
      completed: 5000,
      failed: 0,
    });

    let result = await indicator.isHealthy('bullmq');
    expect(result.details.queues.notifications.healthy).toBe(true);
    expect(result.details.queues.notifications.exceedsThreshold).toBe(true);

    jest.useFakeTimers();
    jest.advanceTimersByTime(61000);

    result = await indicator.isHealthy('bullmq');
    expect(result.status).toBe('down');
    expect(result.details.queues.notifications.healthy).toBe(false);

    jest.useRealTimers();
  });

  it('should recover when backlog returns below threshold', async () => {
    mockQueue.getJobCounts
      .mockResolvedValueOnce({
        wait: 1500,
        delayed: 500,
        active: 10,
        completed: 5000,
        failed: 0,
      })
      .mockResolvedValueOnce({
        wait: 500,
        delayed: 200,
        active: 10,
        completed: 5000,
        failed: 0,
      });

    let result = await indicator.isHealthy('bullmq');
    expect(result.details.queues.notifications.exceedsThreshold).toBe(true);

    result = await indicator.isHealthy('bullmq');
    expect(result.details.queues.notifications.healthy).toBe(true);
    expect(result.details.queues.notifications.exceedsThreshold).toBe(false);
  });

  it('should report per-queue breakdown', async () => {
    mockQueue.getJobCounts.mockResolvedValue({
      wait: 100,
      delayed: 50,
      active: 5,
      completed: 1000,
      failed: 0,
    });

    const result = await indicator.isHealthy('bullmq');
    const queueStats = result.details.queues.notifications;

    expect(queueStats.waiting).toBe(100);
    expect(queueStats.delayed).toBe(50);
    expect(queueStats.backlog).toBe(150);
    expect(queueStats.threshold).toBe(1000);
  });

  it('should handle multiple queues', async () => {
    const mockQueue2 = {
      getJobCounts: jest.fn().mockResolvedValue({
        wait: 50,
        delayed: 10,
        active: 2,
        completed: 500,
        failed: 0,
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        {
          provide: 'BULLMQ_QUEUES',
          useValue: [
            {
              queue: mockQueue,
              name: 'notifications',
              backlogThreshold: 1000,
              sustainMs: 60000,
            } as BullMQQueueConfig,
            {
              queue: mockQueue2,
              name: 'settlements',
              backlogThreshold: 500,
              sustainMs: 60000,
            } as BullMQQueueConfig,
          ],
        },
        BullMQHealthIndicator,
      ],
    }).compile();

    const multiIndicator = module.get<BullMQHealthIndicator>(BullMQHealthIndicator);
    mockQueue.getJobCounts.mockResolvedValue({
      wait: 200,
      delayed: 100,
      active: 5,
      completed: 1000,
      failed: 0,
    });

    const result = await multiIndicator.isHealthy('bullmq');

    expect(result.details.queues.notifications).toBeDefined();
    expect(result.details.queues.settlements).toBeDefined();
    expect(result.details.queues.notifications.backlog).toBe(300);
    expect(result.details.queues.settlements.backlog).toBe(60);
  });

  it('should handle queue fetch errors gracefully', async () => {
    mockQueue.getJobCounts.mockRejectedValue(new Error('Redis connection failed'));

    const result = await indicator.isHealthy('bullmq');

    expect(result.status).toBe('down');
    expect(result.details.queues.notifications.error).toContain('Redis connection failed');
  });
});
