jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { ConfigService } from '@nestjs/config';
import { Job } from 'bull';
import { PermanentError } from '../common/retry';
import {
  PriorityJobExecutionContext,
  PriorityQueueWorker,
} from './priority-queue.worker';
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

function job(
  type: string,
  id = type,
  queueName: string = CRITICAL_QUEUE,
): Job<PriorityJobData> {
  return {
    id,
    data: { type },
    queue: { name: queueName },
    attemptsMade: 0,
    opts: { attempts: 1 },
  } as unknown as Job<PriorityJobData>;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function buildWorker(limits: Partial<Record<QueueCategory, number>> = {}) {
  const lifecycle = new Map<string, string>();
  const key = (queue: string, id: string) => `${queue}:${id}`;
  const priorityQueueServiceMock = {
    beginProcessing: jest.fn(async (queue: string, id: string) => {
      const status = lifecycle.get(key(queue, id)) ?? 'waiting';
      if (status === 'waiting') {
        lifecycle.set(key(queue, id), 'running');
        return 'running';
      }
      return status;
    }),
    getJobLifecycle: jest.fn(
      async (queue: string, id: string) =>
        lifecycle.get(key(queue, id)) ?? 'running',
    ),
    completeProcessing: jest.fn(async (queue: string, id: string) => {
      const status = lifecycle.get(key(queue, id));
      lifecycle.set(
        key(queue, id),
        status === 'cancellation_requested' ? 'cancelled' : 'completed',
      );
      return lifecycle.get(key(queue, id));
    }),
    cancelRequestedProcessing: jest.fn(async (queue: string, id: string) => {
      lifecycle.set(key(queue, id), 'cancelled');
      return 'cancelled';
    }),
    prepareRetry: jest.fn(async (queue: string, id: string) => {
      const status = lifecycle.get(key(queue, id));
      if (status === 'cancellation_requested') return status;
      lifecycle.set(key(queue, id), 'waiting');
      return 'waiting';
    }),
    failProcessing: jest.fn(async (queue: string, id: string) => {
      lifecycle.set(key(queue, id), 'failed');
    }),
  };
  const queues = {
    [CRITICAL_QUEUE]: fakeQueue(CRITICAL_QUEUE),
    [PRIORITY_QUEUE]: fakeQueue(PRIORITY_QUEUE),
    [LOW_PRIORITY_QUEUE]: fakeQueue(LOW_PRIORITY_QUEUE),
  };
  const priorityQueueService = {
    ...priorityQueueServiceMock,
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
  return {
    worker,
    queues,
    lifecycle,
    setLifecycle: (queue: string, id: string, status: string) =>
      lifecycle.set(key(queue, id), status),
    requestCancellation: (queue: string, id: string) => {
      const current = lifecycle.get(key(queue, id));
      if (
        current === 'completed' ||
        current === 'failed' ||
        current === 'cancelled'
      ) {
        return current;
      }
      lifecycle.set(key(queue, id), 'cancellation_requested');
      return 'cancellation_requested';
    },
  };
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
    expect(handler).toHaveBeenCalledWith(
      input,
      expect.objectContaining({ checkpoint: expect.any(Function) }),
    );
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

  it('stops at a safe checkpoint and records cancellation without doing later writes', async () => {
    const { worker, queues, lifecycle, setLifecycle } = buildWorker();
    const gate = deferred();
    const writes: string[] = [];
    const handler = jest.fn(
      async (_job: Job<PriorityJobData>, context: PriorityJobExecutionContext) => {
        writes.push('committed-unit');
        await gate.promise;
        await context.checkpoint();
        writes.push('next-unit');
      },
    );
    worker.registerHandler('cancellable', handler);
    worker.onModuleInit();
    const input = job('cancellable');

    const processing = queues[CRITICAL_QUEUE].processor!(input);
    await Promise.resolve();
    await Promise.resolve();
    setLifecycle(CRITICAL_QUEUE, String(input.id), 'cancellation_requested');
    gate.resolve();

    await expect(processing).resolves.toEqual({ status: 'cancelled' });
    expect(writes).toEqual(['committed-unit']);
    expect(
      lifecycle.get(`${CRITICAL_QUEUE}:${String(input.id)}`),
    ).toBe('cancelled');
  });

  it('does not change a completed job when cancellation arrives afterward', async () => {
    const { worker, queues, lifecycle, requestCancellation } = buildWorker();
    worker.registerHandler('fast', jest.fn().mockResolvedValue('done'));
    worker.onModuleInit();
    const input = job('fast');

    await expect(queues[CRITICAL_QUEUE].processor!(input)).resolves.toBe(
      'done',
    );
    expect(
      requestCancellation(CRITICAL_QUEUE, String(input.id)),
    ).toBe('completed');
    expect(
      lifecycle.get(`${CRITICAL_QUEUE}:${String(input.id)}`),
    ).toBe('completed');
  });

  it('treats a cancellation requested before dispatch as cancelled', async () => {
    const { worker, queues, setLifecycle } = buildWorker();
    const handler = jest.fn();
    worker.registerHandler('not-started', handler);
    worker.onModuleInit();
    const input = job('not-started');
    setLifecycle(
      CRITICAL_QUEUE,
      String(input.id),
      'cancellation_requested',
    );

    await expect(queues[CRITICAL_QUEUE].processor!(input)).resolves.toEqual({
      status: 'cancelled',
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
