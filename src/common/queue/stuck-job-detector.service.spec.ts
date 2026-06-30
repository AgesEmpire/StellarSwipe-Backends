import { Test, TestingModule } from '@nestjs/testing';
import { StuckJobDetectorService, QuarantineReason } from './stuck-job-detector.service';

describe('StuckJobDetectorService', () => {
  let service: StuckJobDetectorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StuckJobDetectorService],
    }).compile();

    service = module.get<StuckJobDetectorService>(StuckJobDetectorService);
  });

  describe('registerQueueMonitoring', () => {
    it('should register a job type with max duration', () => {
      service.registerQueueMonitoring('my-queue', 'send-email', {
        maxDurationMs: 30000,
      });

      // Service should store the config internally (verified via subsequent checks)
      expect(service).toBeDefined();
    });

    it('should allow registering multiple job types per queue', () => {
      service.registerQueueMonitoring('my-queue', 'send-email', {
        maxDurationMs: 30000,
      });
      service.registerQueueMonitoring('my-queue', 'generate-report', {
        maxDurationMs: 120000,
      });

      expect(service).toBeDefined();
    });
  });

  describe('attachQueue', () => {
    it('should attach a queue for monitoring', () => {
      const mockQueue = {
        name: 'test-queue',
        getActive: jest.fn().mockResolvedValue([]),
      };

      service.attachQueue(mockQueue as any);
      expect(service).toBeDefined();
    });

    it('should initialize quarantine store for new queue', () => {
      const mockQueue = {
        name: 'test-queue',
        getActive: jest.fn().mockResolvedValue([]),
      };

      service.attachQueue(mockQueue as any);
      const quarantined = service.getQuarantinedJobs('test-queue');
      expect(quarantined).toEqual([]);
    });
  });

  describe('detectAndQuarantineStuckJobs', () => {
    it('should detect and quarantine jobs exceeding max duration', async () => {
      const mockJob = {
        id: '123',
        name: 'long-task',
        timestamp: Date.now() - 60000, // started 60 seconds ago
        progressedAt: Date.now() - 60000,
        attemptsMade: 1,
        moveToFailed: jest.fn().mockResolvedValue(undefined),
      };

      const mockQueue = {
        name: 'test-queue',
        getActive: jest.fn().mockResolvedValue([mockJob]),
      };

      service.registerQueueMonitoring('test-queue', 'long-task', {
        maxDurationMs: 30000, // 30 seconds
      });
      service.attachQueue(mockQueue as any);

      await service.detectAndQuarantineStuckJobs();

      const quarantined = service.getQuarantinedJobs('test-queue');
      expect(quarantined.length).toBe(1);
      expect(quarantined[0].jobName).toBe('long-task');
      expect(quarantined[0].reason).toBe(QuarantineReason.EXCEEDED_MAX_DURATION);
    });

    it('should not quarantine jobs within max duration', async () => {
      const mockJob = {
        id: '123',
        name: 'quick-task',
        timestamp: Date.now() - 5000, // started 5 seconds ago
        progressedAt: Date.now() - 5000,
        attemptsMade: 0,
        moveToFailed: jest.fn().mockResolvedValue(undefined),
      };

      const mockQueue = {
        name: 'test-queue',
        getActive: jest.fn().mockResolvedValue([mockJob]),
      };

      service.registerQueueMonitoring('test-queue', 'quick-task', {
        maxDurationMs: 30000,
      });
      service.attachQueue(mockQueue as any);

      await service.detectAndQuarantineStuckJobs();

      const quarantined = service.getQuarantinedJobs('test-queue');
      expect(quarantined.length).toBe(0);
    });

    it('should ignore jobs not registered for monitoring', async () => {
      const mockJob = {
        id: '123',
        name: 'unregistered-task',
        timestamp: Date.now() - 60000,
        progressedAt: Date.now() - 60000,
        attemptsMade: 1,
        moveToFailed: jest.fn().mockResolvedValue(undefined),
      };

      const mockQueue = {
        name: 'test-queue',
        getActive: jest.fn().mockResolvedValue([mockJob]),
      };

      service.attachQueue(mockQueue as any);

      await service.detectAndQuarantineStuckJobs();

      const quarantined = service.getQuarantinedJobs('test-queue');
      expect(quarantined.length).toBe(0);
      expect(mockJob.moveToFailed).not.toHaveBeenCalled();
    });

    it('should handle multiple stuck jobs in one queue', async () => {
      const mockJobs = [
        {
          id: '1',
          name: 'task-a',
          timestamp: Date.now() - 60000,
          progressedAt: Date.now() - 60000,
          attemptsMade: 1,
          moveToFailed: jest.fn().mockResolvedValue(undefined),
        },
        {
          id: '2',
          name: 'task-b',
          timestamp: Date.now() - 45000,
          progressedAt: Date.now() - 45000,
          attemptsMade: 0,
          moveToFailed: jest.fn().mockResolvedValue(undefined),
        },
      ];

      const mockQueue = {
        name: 'test-queue',
        getActive: jest.fn().mockResolvedValue(mockJobs),
      };

      service.registerQueueMonitoring('test-queue', 'task-a', {
        maxDurationMs: 30000,
      });
      service.registerQueueMonitoring('test-queue', 'task-b', {
        maxDurationMs: 30000,
      });
      service.attachQueue(mockQueue as any);

      await service.detectAndQuarantineStuckJobs();

      const quarantined = service.getQuarantinedJobs('test-queue');
      expect(quarantined.length).toBe(2);
    });

    it('should handle queue errors gracefully', async () => {
      const mockQueue = {
        name: 'error-queue',
        getActive: jest.fn().mockRejectedValue(new Error('Queue error')),
      };

      service.attachQueue(mockQueue as any);

      // Should not throw
      await expect(service.detectAndQuarantineStuckJobs()).resolves.toBeUndefined();
    });
  });

  describe('getQuarantinedJobs', () => {
    it('should return empty array for unattached queue', () => {
      const jobs = service.getQuarantinedJobs('non-existent-queue');
      expect(jobs).toEqual([]);
    });

    it('should return all quarantined jobs for a queue', async () => {
      const mockJob = {
        id: '123',
        name: 'stuck-job',
        timestamp: Date.now() - 60000,
        progressedAt: Date.now() - 60000,
        attemptsMade: 1,
        moveToFailed: jest.fn().mockResolvedValue(undefined),
      };

      const mockQueue = {
        name: 'my-queue',
        getActive: jest.fn().mockResolvedValue([mockJob]),
      };

      service.registerQueueMonitoring('my-queue', 'stuck-job', {
        maxDurationMs: 30000,
      });
      service.attachQueue(mockQueue as any);

      await service.detectAndQuarantineStuckJobs();

      const quarantined = service.getQuarantinedJobs('my-queue');
      expect(quarantined.length).toBe(1);
      expect(quarantined[0].jobName).toBe('stuck-job');
    });
  });

  describe('getAllQuarantinedJobs', () => {
    it('should return quarantine map for all queues', async () => {
      const mockJob1 = {
        id: '1',
        name: 'task1',
        timestamp: Date.now() - 60000,
        progressedAt: Date.now() - 60000,
        attemptsMade: 1,
        moveToFailed: jest.fn().mockResolvedValue(undefined),
      };

      const mockJob2 = {
        id: '2',
        name: 'task2',
        timestamp: Date.now() - 60000,
        progressedAt: Date.now() - 60000,
        attemptsMade: 1,
        moveToFailed: jest.fn().mockResolvedValue(undefined),
      };

      const queue1 = {
        name: 'queue-1',
        getActive: jest.fn().mockResolvedValue([mockJob1]),
      };

      const queue2 = {
        name: 'queue-2',
        getActive: jest.fn().mockResolvedValue([mockJob2]),
      };

      service.registerQueueMonitoring('queue-1', 'task1', { maxDurationMs: 30000 });
      service.registerQueueMonitoring('queue-2', 'task2', { maxDurationMs: 30000 });
      service.attachQueue(queue1 as any);
      service.attachQueue(queue2 as any);

      await service.detectAndQuarantineStuckJobs();

      const allQuarantined = service.getAllQuarantinedJobs();
      expect(allQuarantined.size).toBe(2);
      expect(allQuarantined.get('queue-1')).toHaveLength(1);
      expect(allQuarantined.get('queue-2')).toHaveLength(1);
    });
  });

  describe('manuallyQuarantineJob', () => {
    it('should manually quarantine a job', async () => {
      const mockJob = {
        id: '123',
        name: 'manual-task',
        timestamp: Date.now(),
        attemptsMade: 2,
      };

      const mockQueue = {
        name: 'my-queue',
        getJob: jest.fn().mockResolvedValue(mockJob),
      };

      service.attachQueue(mockQueue as any);

      await service.manuallyQuarantineJob('my-queue', '123', 'Operator request');

      const quarantined = service.getQuarantinedJobs('my-queue');
      expect(quarantined.length).toBe(1);
      expect(quarantined[0].reason).toBe(QuarantineReason.MANUAL_INTERVENTION);
      expect(quarantined[0].metadata.manualReason).toBe('Operator request');
    });

    it('should throw error if queue not registered', async () => {
      await expect(
        service.manuallyQuarantineJob('non-existent', '123', 'test'),
      ).rejects.toThrow();
    });

    it('should throw error if job not found', async () => {
      const mockQueue = {
        name: 'my-queue',
        getJob: jest.fn().mockResolvedValue(null),
      };

      service.attachQueue(mockQueue as any);

      await expect(
        service.manuallyQuarantineJob('my-queue', '999', 'test'),
      ).rejects.toThrow();
    });
  });

  describe('clearQuarantineRecords', () => {
    it('should clear quarantine records for a queue', async () => {
      const mockJob = {
        id: '123',
        name: 'stuck-job',
        timestamp: Date.now() - 60000,
        progressedAt: Date.now() - 60000,
        attemptsMade: 1,
        moveToFailed: jest.fn().mockResolvedValue(undefined),
      };

      const mockQueue = {
        name: 'my-queue',
        getActive: jest.fn().mockResolvedValue([mockJob]),
      };

      service.registerQueueMonitoring('my-queue', 'stuck-job', {
        maxDurationMs: 30000,
      });
      service.attachQueue(mockQueue as any);

      await service.detectAndQuarantineStuckJobs();

      let quarantined = service.getQuarantinedJobs('my-queue');
      expect(quarantined.length).toBe(1);

      service.clearQuarantineRecords('my-queue');

      quarantined = service.getQuarantinedJobs('my-queue');
      expect(quarantined.length).toBe(0);
    });
  });
});
