jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { PermanentError } from '../common/retry';
import { PriorityQueueWorker } from './priority-queue.worker';
import {
  CRITICAL_QUEUE,
  LOW_PRIORITY_QUEUE,
  PRIORITY_QUEUE,
  PriorityJobData,
  PriorityQueueService,
} from './priority-queue.service';
import {
  QueueCategory,
  queueConcurrencyConfig,
} from './queue-concurrency.config';

type Processor = (job: Job<PriorityJobData>) => Promise<unknown>;

function fakeQueue(name: string) {
  const queue = {
    name,
    concurrency: 0,
    processor: undefined as Processor | undefined,
    process: jest.fn(
      (_name: string, concurrency: number, processor: Processor) => {
        queue.concurrency = concurrency;
        queue.processor = processor;
        return Promise.resolve();
      },
    ),
  };
  return queue;
}

function job(type: string): Job<PriorityJobData> {
  return { id: type, data: { type } } as unknown as Job<PriorityJobData>;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function buildWorker(limits: Partial<Record<QueueCategory, number>> = {}) {
  const queues = {
    [CRITICAL_QUEUE]: fakeQueue(CRITICAL_QUEUE),
    [PRIORITY_QUEUE]: fakeQueue(PRIORITY_QUEUE),
    [LOW_PRIORITY_QUEUE]: fakeQueue(LOW_PRIORITY_QUEUE),
  };
  const priorityQueueService = {
    getCriticalQueue: () => queues[CRITICAL_QUEUE],
    getQueue: () => queues[PRIORITY_QUEUE],
    getLowPriorityQueue: () => queues[LOW_PRIORITY_QUEUE],
  } as unknown as PriorityQueueService;
  const config = {
    get: (key: string) =>
      limits[key.replace('queueConcurrency.', '') as QueueCategory],
  } as unknown as ConfigService;

  const worker = new PriorityQueueWorker(priorityQueueService, config);
  jest.spyOn((worker as any).logger, 'log').mockImplementation(() => {});
  return { worker, queues };
}

describe('queueConcurrencyConfig', () => {
  const keys = [
    'QUEUE_CONCURRENCY_LATENCY_SENSITIVE',
    'QUEUE_CONCURRENCY_BACKGROUND',
  ];
  afterEach(() => keys.forEach((key) => delete process.env[key]));

  it('uses the defaults when unset', () => {
    expect(queueConcurrencyConfig()).toEqual({
      latencySensitive: 10,
      background: 2,
    });
  });

  it('reads each category independently', () => {
    process.env.QUEUE_CONCURRENCY_LATENCY_SENSITIVE = '25';
    process.env.QUEUE_CONCURRENCY_BACKGROUND = '3';
    expect(queueConcurrencyConfig()).toEqual({
      latencySensitive: 25,
      background: 3,
    });
  });

  it.each(['0', '-2', '1.5', 'many'])(
    'rejects an invalid limit "%s"',
    (value) => {
      process.env.QUEUE_CONCURRENCY_BACKGROUND = value;
      expect(() => queueConcurrencyConfig()).toThrow(
        'QUEUE_CONCURRENCY_BACKGROUND',
      );
    },
  );
});

describe('PriorityQueueWorker', () => {
  it('starts a worker per queue with its category ceiling', () => {
    const { worker, queues } = buildWorker({
      latencySensitive: 8,
      background: 3,
    });
    worker.onModuleInit();

    expect(queues[CRITICAL_QUEUE].process).toHaveBeenCalledWith(
      '*',
      8,
      expect.any(Function),
    );
    expect(queues[PRIORITY_QUEUE].process).toHaveBeenCalledWith(
      '*',
      8,
      expect.any(Function),
    );
    expect(queues[LOW_PRIORITY_QUEUE].process).toHaveBeenCalledWith(
      '*',
      3,
      expect.any(Function),
    );
  });

  it('falls back to the default ceilings when config is missing', () => {
    const { worker, queues } = buildWorker();
    worker.onModuleInit();

    expect(queues[CRITICAL_QUEUE].concurrency).toBe(10);
    expect(queues[LOW_PRIORITY_QUEUE].concurrency).toBe(2);
  });

  it('dispatches jobs to the handler registered for their type', async () => {
    const { worker, queues } = buildWorker();
    const handler = jest.fn().mockResolvedValue('done');
    worker.registerHandler('execute-order', handler);
    worker.onModuleInit();

    const input = job('execute-order');
    await expect(queues[CRITICAL_QUEUE].processor!(input)).resolves.toBe(
      'done',
    );
    expect(handler).toHaveBeenCalledWith(input);
  });

  it('fails a job with no registered handler permanently', async () => {
    const { worker, queues } = buildWorker();
    worker.onModuleInit();

    await expect(
      queues[PRIORITY_QUEUE].processor!(job('unknown')),
    ).rejects.toBeInstanceOf(PermanentError);
  });

  it('rejects duplicate handler registrations', () => {
    const { worker } = buildWorker();
    worker.registerHandler('a', jest.fn());
    expect(() => worker.registerHandler('a', jest.fn())).toThrow(
      'already registered',
    );
  });

  it('caps a category at its ceiling across all of its queues', async () => {
    const { worker, queues } = buildWorker({ latencySensitive: 1 });
    const gate = deferred();
    const handler = jest.fn(() => gate.promise);
    worker.registerHandler('slow', handler);
    worker.onModuleInit();

    const first = queues[CRITICAL_QUEUE].processor!(job('slow'));
    const second = queues[PRIORITY_QUEUE].processor!(job('slow'));
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(worker.getCategoryMetrics()).toContainEqual(
      expect.objectContaining({
        category: QueueCategory.LATENCY_SENSITIVE,
        active: 1,
        queued: 1,
      }),
    );

    gate.resolve();
    await Promise.all([first, second]);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('keeps latency-sensitive work running while background work is saturated', async () => {
    const { worker, queues } = buildWorker({
      latencySensitive: 1,
      background: 1,
    });
    const gate = deferred();
    worker.registerHandler('analytics', () => gate.promise);
    const urgent = jest.fn().mockResolvedValue('filled');
    worker.registerHandler('stop-loss', urgent);
    worker.onModuleInit();

    const background = queues[LOW_PRIORITY_QUEUE].processor!(job('analytics'));
    await expect(
      queues[CRITICAL_QUEUE].processor!(job('stop-loss')),
    ).resolves.toBe('filled');
    expect(worker.getCategoryMetrics()).toContainEqual(
      expect.objectContaining({
        category: QueueCategory.BACKGROUND,
        active: 1,
      }),
    );

    gate.resolve();
    await background;
  });
});
