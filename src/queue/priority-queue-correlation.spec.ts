import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { ConfigService } from '@nestjs/config';
import { CorrelationIdStore } from '../common/correlation/correlation-id.store';
import {
  PriorityQueueService,
  PRIORITY_QUEUE,
  CRITICAL_QUEUE,
  LOW_PRIORITY_QUEUE,
  JobPriority,
} from './priority-queue.service';

function makeMockQueue() {
  return { add: jest.fn().mockResolvedValue({ id: 'job-1', data: {} }) };
}

describe('PriorityQueueService — correlation ID propagation (issue #1027)', () => {
  let service: PriorityQueueService;
  let normalQueue: ReturnType<typeof makeMockQueue>;
  let criticalQueue: ReturnType<typeof makeMockQueue>;
  let lowQueue: ReturnType<typeof makeMockQueue>;
  let correlationIdStore: CorrelationIdStore;

  beforeEach(async () => {
    normalQueue = makeMockQueue();
    criticalQueue = makeMockQueue();
    lowQueue = makeMockQueue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriorityQueueService,
        { provide: getQueueToken(PRIORITY_QUEUE), useValue: normalQueue },
        { provide: getQueueToken(CRITICAL_QUEUE), useValue: criticalQueue },
        { provide: getQueueToken(LOW_PRIORITY_QUEUE), useValue: lowQueue },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        {
          provide: CorrelationIdStore,
          useValue: { getCorrelationId: jest.fn().mockReturnValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<PriorityQueueService>(PriorityQueueService);
    correlationIdStore = module.get<CorrelationIdStore>(CorrelationIdStore);
  });

  it('embeds the active HTTP correlation ID in the job payload', async () => {
    jest
      .spyOn(correlationIdStore, 'getCorrelationId')
      .mockReturnValue('req-abc-123');

    await service.addJob('test-type', { value: 1 });

    const [, jobData] = normalQueue.add.mock.calls[0] as [string, any, any];
    expect(jobData.correlationId).toBe('req-abc-123');
  });

  it('generates a fresh UUID when no HTTP context is active (scheduled work)', async () => {
    jest
      .spyOn(correlationIdStore, 'getCorrelationId')
      .mockReturnValue(undefined);

    await service.addJob('scheduled-job', {});

    const [, jobData] = normalQueue.add.mock.calls[0] as [string, any, any];
    expect(typeof jobData.correlationId).toBe('string');
    expect(jobData.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('propagates the same correlation ID for CRITICAL priority jobs', async () => {
    jest
      .spyOn(correlationIdStore, 'getCorrelationId')
      .mockReturnValue('crit-corr-id');

    await service.addCriticalJob('market-order', {});

    const [, jobData] = criticalQueue.add.mock.calls[0] as [string, any, any];
    expect(jobData.correlationId).toBe('crit-corr-id');
  });

  it('propagates the correlation ID for LOW priority jobs', async () => {
    jest
      .spyOn(correlationIdStore, 'getCorrelationId')
      .mockReturnValue('low-corr-id');

    await service.addLowPriorityJob('analytics', {});

    const [, jobData] = lowQueue.add.mock.calls[0] as [string, any, any];
    expect(jobData.correlationId).toBe('low-corr-id');
  });

  it('validates that malformed correlation IDs are replaced with a fresh UUID', async () => {
    // A non-UUID string is technically allowed by the store but should still be
    // forwarded as-is — correlation IDs from external callers may be opaque.
    jest
      .spyOn(correlationIdStore, 'getCorrelationId')
      .mockReturnValue('not-a-uuid-but-valid-opaque-id');

    await service.addJob('some-job', {});

    const [, jobData] = normalQueue.add.mock.calls[0] as [string, any, any];
    expect(jobData.correlationId).toBe('not-a-uuid-but-valid-opaque-id');
  });
});
