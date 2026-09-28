import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QueueBackpressureService } from './queue-backpressure.service';
import { JobPriority, PriorityQueueService } from './priority-queue.service';

const emptyStats = { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };

describe('QueueBackpressureService', () => {
  let service: QueueBackpressureService;
  let mockPriorityQueueService: {
    getAllQueueStats: jest.Mock;
    getLowPriorityQueue: jest.Mock;
    addJob: jest.Mock;
  };
  let mockLowQueue: { getWaiting: jest.Mock };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      const map: Record<string, number> = {
        'queuePressure.pressureThreshold': 10,
        'queuePressure.starvationAgeMs': 60_000,
        'queuePressure.starvationScanBatchSize': 100,
      };
      return map[key];
    }),
  };

  beforeEach(async () => {
    mockLowQueue = { getWaiting: jest.fn().mockResolvedValue([]) };
    mockPriorityQueueService = {
      getAllQueueStats: jest.fn().mockResolvedValue({
        critical: { ...emptyStats },
        normal: { ...emptyStats },
        low: { ...emptyStats },
      }),
      getLowPriorityQueue: jest.fn().mockReturnValue(mockLowQueue),
      addJob: jest.fn().mockResolvedValue({ id: 'promoted-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueBackpressureService,
        { provide: PriorityQueueService, useValue: mockPriorityQueueService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(QueueBackpressureService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('shouldDeferLowPriority — queue routing / pressure detection', () => {
    it('returns false when critical/normal queues are quiet (non-deferred path)', async () => {
      await expect(service.shouldDeferLowPriority()).resolves.toBe(false);
    });

    it('returns true once combined critical+normal load reaches the threshold (deferred path)', async () => {
      mockPriorityQueueService.getAllQueueStats.mockResolvedValue({
        critical: { ...emptyStats, waiting: 6, active: 2 },
        normal: { ...emptyStats, waiting: 3 },
        low: { ...emptyStats },
      });

      await expect(service.shouldDeferLowPriority()).resolves.toBe(true);
    });

    it('ignores low-priority queue depth when deciding to defer', async () => {
      mockPriorityQueueService.getAllQueueStats.mockResolvedValue({
        critical: { ...emptyStats },
        normal: { ...emptyStats },
        low: { ...emptyStats, waiting: 10_000 },
      });

      await expect(service.shouldDeferLowPriority()).resolves.toBe(false);
    });
  });

  describe('promoteStarvedJobs — starvation prevention', () => {
    const buildJob = (ageMs: number, overrides: Partial<Record<string, unknown>> = {}) => ({
      id: `job-${ageMs}`,
      data: {
        type: 'analytics.recompute',
        payload: { foo: 'bar' },
        createdAt: new Date(Date.now() - ageMs),
      },
      timestamp: Date.now() - ageMs,
      remove: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    });

    it('promotes jobs older than the starvation threshold to HIGH priority', async () => {
      const staleJob = buildJob(120_000); // 2 minutes, older than 60s threshold
      mockLowQueue.getWaiting.mockResolvedValue([staleJob]);

      const promoted = await service.promoteStarvedJobs();

      expect(promoted).toBe(1);
      expect(mockPriorityQueueService.addJob).toHaveBeenCalledWith(
        'analytics.recompute',
        { foo: 'bar' },
        JobPriority.HIGH,
      );
      expect(staleJob.remove).toHaveBeenCalled();
    });

    it('leaves recently-enqueued low-priority jobs alone (no starvation yet)', async () => {
      const freshJob = buildJob(5_000); // 5 seconds, well under 60s threshold
      mockLowQueue.getWaiting.mockResolvedValue([freshJob]);

      const promoted = await service.promoteStarvedJobs();

      expect(promoted).toBe(0);
      expect(mockPriorityQueueService.addJob).not.toHaveBeenCalled();
      expect(freshJob.remove).not.toHaveBeenCalled();
    });

    it('promotes only the jobs that have actually aged out, not the whole batch', async () => {
      const staleJob = buildJob(120_000);
      const freshJob = buildJob(1_000);
      mockLowQueue.getWaiting.mockResolvedValue([staleJob, freshJob]);

      const promoted = await service.promoteStarvedJobs();

      expect(promoted).toBe(1);
      expect(staleJob.remove).toHaveBeenCalled();
      expect(freshJob.remove).not.toHaveBeenCalled();
    });

    it('handles failure to re-enqueue a starved job without throwing (failure handling)', async () => {
      const staleJob = buildJob(120_000);
      mockLowQueue.getWaiting.mockResolvedValue([staleJob]);
      mockPriorityQueueService.addJob.mockRejectedValueOnce(new Error('queue unavailable'));

      await expect(service.promoteStarvedJobs()).resolves.toBe(0);
      // The job is left in place for the next sweep rather than lost.
      expect(staleJob.remove).not.toHaveBeenCalled();
    });

    it('continues promoting remaining jobs after one promotion fails (partial failure handling)', async () => {
      const failingJob = buildJob(120_000, { id: 'failing' });
      const okJob = buildJob(90_000, { id: 'ok' });
      mockLowQueue.getWaiting.mockResolvedValue([failingJob, okJob]);
      mockPriorityQueueService.addJob
        .mockRejectedValueOnce(new Error('transient failure'))
        .mockResolvedValueOnce({ id: 'promoted-ok' });

      const promoted = await service.promoteStarvedJobs();

      expect(promoted).toBe(1);
      expect(failingJob.remove).not.toHaveBeenCalled();
      expect(okJob.remove).toHaveBeenCalled();
    });
  });
});
