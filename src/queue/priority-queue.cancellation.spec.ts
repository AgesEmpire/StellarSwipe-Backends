import { ConfigService } from '@nestjs/config';
import { Queue } from 'bull';
import { CorrelationIdStore } from '../common/correlation/correlation-id.store';
import {
  CRITICAL_QUEUE,
  JobLifecycleStatus,
  LOW_PRIORITY_QUEUE,
  PRIORITY_QUEUE,
  PriorityJobData,
  PriorityQueueService,
} from './priority-queue.service';

function buildService(
  initialStatus: JobLifecycleStatus,
  initialBullState: string,
) {
  const states = new Map<string, string>();
  const lifecycleKey = `${PRIORITY_QUEUE}:job-1:lifecycle`;
  states.set(lifecycleKey, initialStatus);

  let bullState = initialBullState;
  const job = {
    getState: jest.fn(async () => bullState),
    remove: jest.fn(async () => {
      bullState = 'unknown';
    }),
  };

  const redis = {
    get: jest.fn(async (key: string) => states.get(key) ?? null),
    set: jest.fn(
      async (
        key: string,
        value: string,
        _expiryMode: string,
        _ttl: number,
        _onlyIfMissing: string,
      ) => {
        if (states.has(key)) return null;
        states.set(key, value);
        return 'OK';
      },
    ),
    eval: jest.fn(
      async (script: string, _keyCount: number, key: string, ttl: number) => {
        const state = states.get(key);
        if (script.includes('Invalid job lifecycle state')) {
          if (
            state === 'cancelled' ||
            state === 'completed' ||
            state === 'failed'
          ) {
            return state;
          }
          if (state === 'cancellation_requested') return state;
          if (state === 'running' || state === 'waiting' || !state) {
            states.set(key, 'cancellation_requested');
            return 'cancellation_requested';
          }
        }
        if (script.includes("redis.call('SET', KEYS[1], 'completed'")) {
          const next =
            state === 'cancellation_requested' ? 'cancelled' : 'completed';
          states.set(key, next);
          return next;
        }
        if (
          script.includes("if state == 'cancellation_requested' then") &&
          script.includes("redis.call('SET', KEYS[1], 'cancelled'")
        ) {
          if (state === 'cancellation_requested') {
            states.set(key, 'cancelled');
            return 'cancelled';
          }
          return state;
        }
        if (script.includes("redis.call('SET', KEYS[1], 'failed'")) {
          states.set(key, 'failed');
          return 'failed';
        }
        if (script.includes("redis.call('SET', KEYS[1], 'waiting'")) {
          const next =
            state === 'cancellation_requested' ? 'cancelled' : 'waiting';
          states.set(key, next);
          return next;
        }
        if (script.includes("redis.call('SET', KEYS[1], 'running'")) {
          const next = state === 'waiting' ? 'running' : state ?? 'running';
          states.set(key, next);
          return next;
        }
        if (script.includes("redis.call('GET', KEYS[1]) == 'waiting'")) {
          if (state === 'waiting') {
            states.delete(key);
            return 1;
          }
          return 0;
        }
        void ttl;
        return null;
      },
    ),
  };

  const queue = {
    name: PRIORITY_QUEUE,
    client: redis,
    toKey: (id: string) => `${PRIORITY_QUEUE}:${id}`,
    getJob: jest.fn(async (id: string) => (id === 'job-1' ? job : null)),
  };

  const service = new PriorityQueueService(
    queue as unknown as Queue<PriorityJobData>,
    { ...queue, name: CRITICAL_QUEUE } as unknown as Queue<PriorityJobData>,
    { ...queue, name: LOW_PRIORITY_QUEUE } as unknown as Queue<PriorityJobData>,
    {} as ConfigService,
    {} as CorrelationIdStore,
  );

  return { service, states, lifecycleKey, job };
}

describe('PriorityQueueService cancellation lifecycle', () => {
  it('moves a queued cancellation request to cancelled when the job is removed', async () => {
    const { service, states, lifecycleKey, job } = buildService(
      'waiting',
      'waiting',
    );

    await expect(
      service.requestCancellation(PRIORITY_QUEUE, 'job-1'),
    ).resolves.toBe('cancelled');
    expect(job.remove).toHaveBeenCalledTimes(1);
    expect(states.get(lifecycleKey)).toBe('cancelled');
  });

  it('marks active jobs requested so workers can stop at checkpoints', async () => {
    const { service, states, lifecycleKey, job } = buildService(
      'running',
      'active',
    );

    await expect(
      service.requestCancellation(PRIORITY_QUEUE, 'job-1'),
    ).resolves.toBe('cancellation_requested');
    expect(job.remove).not.toHaveBeenCalled();
    expect(states.get(lifecycleKey)).toBe('cancellation_requested');
  });

  it('keeps completion when cancellation arrives after the worker commits it', async () => {
    const { service, states, lifecycleKey } = buildService(
      'completed',
      'completed',
    );

    await expect(
      service.requestCancellation(PRIORITY_QUEUE, 'job-1'),
    ).resolves.toBe('completed');
    expect(states.get(lifecycleKey)).toBe('completed');
  });

  it('atomically resolves a completion racing a cancellation request', async () => {
    const { service, states, lifecycleKey } = buildService(
      'cancellation_requested',
      'active',
    );

    await expect(
      service.completeProcessing(PRIORITY_QUEUE, 'job-1'),
    ).resolves.toBe('cancelled');
    expect(states.get(lifecycleKey)).toBe('cancelled');
  });

  it('serializes concurrent cancellation and completion into one final outcome', async () => {
    const { service, states, lifecycleKey } = buildService('running', 'active');

    const [cancelStatus, completionStatus] = await Promise.all([
      service.requestCancellation(PRIORITY_QUEUE, 'job-1'),
      service.completeProcessing(PRIORITY_QUEUE, 'job-1'),
    ]);
    const finalStatus = states.get(lifecycleKey);

    expect(['completed', 'cancelled']).toContain(finalStatus);
    if (finalStatus === 'completed') {
      expect(completionStatus).toBe('completed');
    } else {
      expect(completionStatus).toBe('cancelled');
      expect(['cancellation_requested', 'cancelled']).toContain(cancelStatus);
    }
  });

  it('records terminal handler failures distinctly from cancellation', async () => {
    const { service, states, lifecycleKey } = buildService('running', 'active');

    await service.failProcessing(PRIORITY_QUEUE, 'job-1');
    expect(states.get(lifecycleKey)).toBe('failed');
  });

  it('rejects queue names outside the supported set', async () => {
    const { service } = buildService('waiting', 'waiting');

    await expect(
      service.requestCancellation('other-queue', 'job-1'),
    ).rejects.toThrow(/Unsupported cancellable queue/);
  });
});
