import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { Queue } from 'bull';
import { PriorityQueueService, JobPriority, PRIORITY_QUEUE, CRITICAL_QUEUE, LOW_PRIORITY_QUEUE } from './priority-queue.service';

describe('PriorityQueueService', () => {
  let service: PriorityQueueService;
  let priorityQueue: any;
  let criticalQueue: any;
  let lowPriorityQueue: any;

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }),
    getWaiting: jest.fn().mockResolvedValue([]),
    pause: jest.fn(),
    resume: jest.fn(),
    empty: jest.fn(),
    getJobs: jest.fn().mockResolvedValue([]),
    name: 'priority-queue',
  };

  const mockCriticalQueue = {
    ...mockQueue,
    add: jest.fn().mockResolvedValue({ id: 'critical-job-1' }),
    name: 'critical-queue',
  };

  const mockLowQueue = {
    ...mockQueue,
    add: jest.fn().mockResolvedValue({ id: 'low-job-1' }),
    name: 'low-priority-queue',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PriorityQueueService,
        { provide: getQueueToken(PRIORITY_QUEUE), useValue: mockQueue },
        { provide: getQueueToken(CRITICAL_QUEUE), useValue: mockCriticalQueue },

  describe('JobPriority enum', () => {
    it('should have CRITICAL = 1 (highest priority)', () => {
      expect(JobPriority.CRITICAL).toBe(1);
    });

    it('should have HIGH = 10', () => {
      expect(JobPriority.HIGH).toBe(10);
    });

    it('should have NORMAL = 100', () => {
      expect(JobPriority.NORMAL).toBe(100);
    });

    it('should have LOW = 1000 (lowest priority)', () => {
      expect(JobPriority.LOW).toBe(1000);
    });

    it('should have CRITICAL with lower number than NORMAL', () => {
      expect(JobPriority.CRITICAL).toBeLessThan(JobPriority.NORMAL);
    });

    it('should have NORMAL with lower number than LOW', () => {
      expect(JobPriority.NORMAL).toBeLessThan(JobPriority.LOW);
    });
  });

  describe('addJob', () => {
    it('should add a job with CRITICAL priority to the critical queue', async () => {
      const result = await service.addJob('market-order', { orderId: '123' }, JobPriority.CRITICAL);
      expect(criticalQueue.add).toHaveBeenCalledWith(
        'market-order',
        expect.objectContaining({
          type: 'market-order',
          priority: JobPriority.CRITICAL,
        }),
        expect.objectContaining({ priority: JobPriority.CRITICAL }),
      );
      expect(priorityQueue.add).not.toHaveBeenCalled();
      expect(result.id).toBe('critical-job-1');
    });

    it('should add a job with LOW priority to the low priority queue', async () => {
      const result = await service.addJob('analytics-export', { period: 'daily' }, JobPriority.LOW);
      expect(lowPriorityQueue.add).toHaveBeenCalledWith(
        'analytics-export',
        expect.objectContaining({
          type: 'analytics-export',
          priority: JobPriority.LOW,
        }),
        expect.objectContaining({ priority: JobPriority.LOW }),
      );
      expect(priorityQueue.add).not.toHaveBeenCalled();
      expect(result.id).toBe('low-job-1');
    });

    it('should add a NORMAL job to the shared priority queue', async () => {
      const result = await service.addJob('notification', { userId: 'u1' }, JobPriority.NORMAL);
      expect(priorityQueue.add).toHaveBeenCalled();
      expect(criticalQueue.add).not.toHaveBeenCalled();
      expect(lowPriorityQueue.add).not.toHaveBeenCalled();
    });

    it('should use NORMAL priority by default', async () => {
      await service.addJob('default-job', { key: 'val' });
      expect(priorityQueue.add).toHaveBeenCalledWith(
        'default-job',
        expect.objectContaining({ priority: JobPriority.NORMAL }),
        expect.objectContaining({ priority: JobPriority.NORMAL }),

  describe('addCriticalJob', () => {
    it('should add a job to the critical queue with CRITICAL priority', async () => {
      await service.addCriticalJob('stop-loss', { positionId: 'p1' });
      expect(criticalQueue.add).toHaveBeenCalledWith(
        'stop-loss',
        expect.objectContaining({ priority: JobPriority.CRITICAL }),
        expect.objectContaining({ priority: JobPriority.CRITICAL }),
      );
    });
  });

  describe('addHighPriorityJob', () => {
    it('should add a job with HIGH priority', async () => {
      await service.addHighPriorityJob('limit-order', { orderId: 'lo1' });
      expect(priorityQueue.add).toHaveBeenCalledWith(
        'limit-order',
        expect.objectContaining({ priority: JobPriority.HIGH }),
        expect.objectContaining({ priority: JobPriority.HIGH }),
      );
    });
  });

  describe('addNormalPriorityJob', () => {
    it('should add a job with NORMAL priority', async () => {
      await service.addNormalPriorityJob('webhook', { event: 'trade' });
      expect(priorityQueue.add).toHaveBeenCalledWith(
        'webhook',
        expect.objectContaining({ priority: JobPriority.NORMAL }),
        expect.objectContaining({ priority: JobPriority.NORMAL }),
      );
    });
  });

  describe('addLowPriorityJob', () => {
    it('should add a job to the low priority queue', async () => {
      await service.addLowPriorityJob('leaderboard-update', { competitionId: 'c1' });
      expect(lowPriorityQueue.add).toHaveBeenCalledWith(
        'leaderboard-update',
        expect.objectContaining({ priority: JobPriority.LOW }),
        expect.objectContaining({ priority: JobPriority.LOW }),
      );
    });
  });

  describe('getQueueStats', () => {
    it('should return job counts for the shared queue', async () => {
      mockQueue.getJobCounts.mockResolvedValue({ waiting: 5, active: 2, completed: 100, failed: 3, delayed: 1 });
      const stats = await service.getQueueStats();
      expect(stats).toEqual({ waiting: 5, active: 2, completed: 100, failed: 3, delayed: 1 });
    });
  });

  describe('getAllQueueStats', () => {
    it('should return job counts for all 3 priority tiers', async () => {
      mockCriticalQueue.getJobCounts.mockResolvedValue({ waiting: 1, active: 1, completed: 50, failed: 0, delayed: 0 });
      mockQueue.getJobCounts.mockResolvedValue({ waiting: 10, active: 3, completed: 200, failed: 2, delayed: 5 });
      mockLowQueue.getJobCounts.mockResolvedValue({ waiting: 100, active: 5, completed: 500, failed: 10, delayed: 20 });

      const stats = await service.getAllQueueStats();
      expect(stats.critical.waiting).toBe(1);
      expect(stats.normal.waiting).toBe(10);

  describe('getAdminQueueStats', () => {
    it('should return aggregated tier stats with avgWaitTimeMs', async () => {
      mockCriticalQueue.getJobCounts.mockResolvedValue({ waiting: 2, active: 1, completed: 10, failed: 0, delayed: 0 });
      mockQueue.getJobCounts.mockResolvedValue({ waiting: 5, active: 2, completed: 20, failed: 1, delayed: 0 });
      mockLowQueue.getJobCounts.mockResolvedValue({ waiting: 50, active: 3, completed: 100, failed: 2, delayed: 5 });
      mockCriticalQueue.getWaiting.mockResolvedValue([]);
      mockQueue.getWaiting.mockResolvedValue([]);
      mockLowQueue.getWaiting.mockResolvedValue([]);

      const result = await service.getAdminQueueStats();
      expect(result.tiers).toBeDefined();
      expect(result.tiers.critical).toBeDefined();
      expect(result.tiers.normal).toBeDefined();
      expect(result.tiers.low).toBeDefined();
      expect(typeof result.tiers.critical.avgWaitTimeMs).toBe('number');
      expect(result.totalJobs).toBeDefined();
    });
  });

  describe('getQueue', () => {
    it('should return the shared queue when no priority given', () => {
      const q = service.getQueue();
      expect((q as any).name).toBe('priority-queue');
    });

    it('should return the critical queue for CRITICAL priority', () => {
      const q = service.getQueue(JobPriority.CRITICAL);
      expect((q as any).name).toBe('critical-queue');
    });

    it('should return the low queue for LOW priority', () => {
      const q = service.getQueue(JobPriority.LOW);
      expect((q as any).name).toBe('low-priority-queue');
    });
  });

  describe('getCriticalQueue', () => {
    it('should return the critical queue instance', () => {
      const q = service.getCriticalQueue();
      expect((q as any).name).toBe('critical-queue');
    });
  });

  describe('getLowPriorityQueue', () => {
    it('should return the low priority queue instance', () => {
      const q = service.getLowPriorityQueue();
      expect((q as any).name).toBe('low-priority-queue');
    });
  });

  describe('pause / resume / clear', () => {
    it('should pause the shared queue', async () => {
      await service.pause();
      expect(priorityQueue.pause).toHaveBeenCalled();
    });

    it('should resume the shared queue', async () => {
      await service.resume();
      expect(priorityQueue.resume).toHaveBeenCalled();
    });

    it('should clear the shared queue', async () => {
      await service.clear();
      expect(priorityQueue.empty).toHaveBeenCalled();
    });
  });
});

      expect(stats.low.waiting).toBe(100);
    });
  });

      );
    });

    it('should include createdAt date in job data', async () => {
      const before = new Date();
      await service.addJob('test', {}, JobPriority.NORMAL);
      const after = new Date();
      const callData = (priorityQueue.add as jest.Mock).mock.calls[0][1];
      expect(new Date(callData.createdAt).getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(new Date(callData.createdAt).getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

        { provide: getQueueToken(LOW_PRIORITY_QUEUE), useValue: mockLowQueue },
      ],
    }).compile();

    service = module.get<PriorityQueueService>(PriorityQueueService);
    jest.clearAllMocks();
  });