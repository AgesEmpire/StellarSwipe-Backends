jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { CorrelationIdStore } from '../common/correlation/correlation-id.store';
import { UnsupportedPayloadVersionError } from './payload-versioning';
import { QueueBackpressureService } from './queue-backpressure.service';
import {
  PriorityQueueService,
  PRIORITY_QUEUE,
  CRITICAL_QUEUE,
  LOW_PRIORITY_QUEUE,
  PRIORITY_JOB_SCHEMA,
} from './priority-queue.service';

function makeMockQueue() {
  return { add: jest.fn().mockResolvedValue({ id: 'job-1', data: {} }) };
}

function makeJob(data: unknown) {
  return { id: 'job-1', data, discard: jest.fn() } as any;
}

describe('PriorityQueueService — payload schema versioning (issue #1230)', () => {
  let service: PriorityQueueService;
  let normalQueue: ReturnType<typeof makeMockQueue>;

  beforeEach(async () => {
    normalQueue = makeMockQueue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriorityQueueService,
        { provide: getQueueToken(PRIORITY_QUEUE), useValue: normalQueue },
        { provide: getQueueToken(CRITICAL_QUEUE), useValue: makeMockQueue() },
        {
          provide: getQueueToken(LOW_PRIORITY_QUEUE),
          useValue: makeMockQueue(),
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: CorrelationIdStore,
          useValue: { getCorrelationId: jest.fn().mockReturnValue('corr-1') },
        },
      ],
    }).compile();

    service = module.get(PriorityQueueService);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
  });

  it('stamps new jobs with the current schema version', async () => {
    await service.addJob('notify', { userId: 'u1' });

    const [, jobData] = normalQueue.add.mock.calls[0] as [string, any, any];
    expect(jobData.schemaVersion).toBe(PRIORITY_JOB_SCHEMA.currentVersion);
  });

  it('reads back a freshly enqueued job unchanged', async () => {
    await service.addJob('notify', { userId: 'u1' });
    const [, jobData] = normalQueue.add.mock.calls[0] as [string, any, any];

    expect(service.readJobData(makeJob(jobData))).toEqual(jobData);
  });

  it('migrates a job enqueued by an earlier app version', () => {
    const job = makeJob({
      type: 'notify',
      payload: { userId: 'u1' },
      priority: 100,
      createdAt: 'x',
    });

    expect(service.readJobData(job)).toMatchObject({
      schemaVersion: 2,
      type: 'notify',
      payload: { userId: 'u1' },
      correlationId: expect.any(String),
    });
    expect(job.discard).not.toHaveBeenCalled();
  });

  it('rejects an unknown version and discards the job from further retries', () => {
    const job = makeJob({ schemaVersion: 99, type: 'notify' });

    expect(() => service.readJobData(job)).toThrow(
      UnsupportedPayloadVersionError,
    );
    expect(job.discard).toHaveBeenCalled();
  });
});

describe('QueueBackpressureService — starvation sweep with versioned payloads (issue #1230)', () => {
  function staleJob(data: Record<string, unknown>) {
    return {
      id: 'stale',
      data: { createdAt: new Date(Date.now() - 10 * 60_000), ...data },
      timestamp: Date.now() - 10 * 60_000,
      remove: jest.fn().mockResolvedValue(undefined),
    };
  }

  function buildSweep(job: ReturnType<typeof staleJob>) {
    const priorityQueueService = {
      getLowPriorityQueue: () => ({
        getWaiting: jest.fn().mockResolvedValue([job]),
      }),
      addJob: jest.fn().mockResolvedValue({ id: 'promoted' }),
    };
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const service = new QueueBackpressureService(
      priorityQueueService as any,
      config as any,
    );
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
    return { service, priorityQueueService };
  }

  it('promotes a starved job written by an earlier app version', async () => {
    const job = staleJob({ type: 'analytics', payload: { day: 1 } });
    const { service, priorityQueueService } = buildSweep(job);

    await expect(service.promoteStarvedJobs()).resolves.toBe(1);
    expect(priorityQueueService.addJob).toHaveBeenCalledWith(
      'analytics',
      { day: 1 },
      10,
    );
    expect(job.remove).toHaveBeenCalled();
  });

  it('leaves a job with an unsupported payload version in place', async () => {
    const job = staleJob({ schemaVersion: 99, type: 'analytics', payload: {} });
    const { service, priorityQueueService } = buildSweep(job);

    await expect(service.promoteStarvedJobs()).resolves.toBe(0);
    expect(priorityQueueService.addJob).not.toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
  });
});
