import { DeadLetterService, DEAD_LETTER_QUEUE } from '../src/jobs/dead-letter.service';
import { getQueueToken } from '@nestjs/bull';
import { Test } from '@nestjs/testing';

const makeDlqMock = () => ({
  add: jest.fn().mockResolvedValue({ id: 'dlq-1' }),
  getJob: jest.fn(),
  getJobs: jest.fn().mockResolvedValue([]),
  getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, failed: 2 }),
  on: jest.fn(),
});

const makeJob = (overrides: Partial<{ id: string; data: unknown; attemptsMade: number; queueName: string }> = {}) => ({
  id: overrides.id ?? 'job-1',
  data: overrides.data ?? { userId: 42 },
  attemptsMade: overrides.attemptsMade ?? 3,
  queue: { name: overrides.queueName ?? 'main-queue' },
});

describe('DeadLetterService (#368)', () => {
  let service: DeadLetterService;
  let dlq: ReturnType<typeof makeDlqMock>;

  beforeEach(async () => {
    dlq = makeDlqMock();

    const module = await Test.createTestingModule({
      providers: [
        DeadLetterService,
        { provide: getQueueToken(DEAD_LETTER_QUEUE), useValue: dlq },
      ],
    }).compile();

    service = module.get(DeadLetterService);
    service.onModuleInit();
  });

  afterEach(() => jest.clearAllMocks());

  it('capture() adds the failed job to the DLQ with correct shape', async () => {
    const job = makeJob();
    await service.capture(job as any, new Error('timeout'));

    expect(dlq.add).toHaveBeenCalledTimes(1);
    const [entry, opts] = dlq.add.mock.calls[0];
    expect(entry.jobId).toBe('job-1');
    expect(entry.queue).toBe('main-queue');
    expect(entry.data).toEqual({ userId: 42 });
    expect(entry.failedReason).toBe('timeout');
    expect(entry.attemptsMade).toBe(3);
    expect(typeof entry.failedAt).toBe('string'); // ISO string
    expect(opts.attempts).toBe(1);
  });

  it('list() delegates to dlq.getJobs with correct states', async () => {
    const fakeJobs = [{ id: 'dlq-1' }];
    dlq.getJobs.mockResolvedValueOnce(fakeJobs);
    const result = await service.list();
    expect(dlq.getJobs).toHaveBeenCalledWith(['waiting', 'failed']);
    expect(result).toBe(fakeJobs);
  });

  it('counts() returns job counts from the DLQ', async () => {
    const result = await service.counts();
    expect(result).toEqual({ waiting: 0, failed: 2 });
  });

  it('discard() removes the job when found', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    dlq.getJob.mockResolvedValueOnce({ remove });
    await service.discard('dlq-1');
    expect(remove).toHaveBeenCalled();
  });

  it('discard() is a no-op when job is not found', async () => {
    dlq.getJob.mockResolvedValueOnce(null);
    await expect(service.discard('missing')).resolves.not.toThrow();
  });

  it('replay() re-queues the original data and removes the DLQ entry', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    dlq.getJob.mockResolvedValueOnce({ data: { data: { userId: 42 } }, remove });
    const targetAdd = jest.fn().mockResolvedValue({ id: 'new-1' });
    const targetQueue = { name: 'main-queue', add: targetAdd } as any;

    const result = await service.replay('dlq-1', targetQueue);

    expect(targetAdd).toHaveBeenCalledWith({ userId: 42 }, { attempts: 3 });
    expect(remove).toHaveBeenCalled();
    expect(result).toEqual({ id: 'new-1' });
  });

  it('replay() returns null when DLQ job is not found', async () => {
    dlq.getJob.mockResolvedValueOnce(null);
    expect(await service.replay('missing', {} as any)).toBeNull();
  });
});
