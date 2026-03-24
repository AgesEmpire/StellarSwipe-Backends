import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import {
  ExecuteScheduledTradesJob,
  SCHEDULED_TRADES_QUEUE,
} from './execute-scheduled-trades.job';
import { ScheduledTradesService } from '../scheduled-trades.service';

describe('ExecuteScheduledTradesJob', () => {
  let job: ExecuteScheduledTradesJob;
  let queue: { getRepeatableJobs: jest.Mock; add: jest.Mock };
  let service: jest.Mocked<ScheduledTradesService>;

  beforeEach(async () => {
    queue = {
      getRepeatableJobs: jest.fn(),
      add: jest.fn(),
    };

    const mockService = {
      evaluateScheduledTrades: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecuteScheduledTradesJob,
        { provide: getQueueToken(SCHEDULED_TRADES_QUEUE), useValue: queue },
        { provide: ScheduledTradesService, useValue: mockService },
      ],
    }).compile();

    job = module.get<ExecuteScheduledTradesJob>(ExecuteScheduledTradesJob);
    service = module.get(ScheduledTradesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('onModuleInit', () => {
    it('should add repeatable job when it does not exist', async () => {
      queue.getRepeatableJobs.mockResolvedValue([]);
      queue.add.mockResolvedValue(undefined);

      await job.onModuleInit();

      expect(queue.add).toHaveBeenCalledWith(
        'evaluate',
        {},
        expect.objectContaining({
          jobId: 'evaluate-scheduled-trades',
          repeat: { every: 60000 },
          removeOnComplete: true,
          removeOnFail: true,
        }),
      );
    });

    it('should not add job if it already exists', async () => {
      queue.getRepeatableJobs.mockResolvedValue([
        { id: 'evaluate-scheduled-trades', name: 'evaluate', every: 60000 },
      ]);

      await job.onModuleInit();

      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('handleEvaluation', () => {
    it('should call service.evaluateScheduledTrades', async () => {
      service.evaluateScheduledTrades.mockResolvedValue(undefined);

      await job.handleEvaluation({} as any);

      expect(service.evaluateScheduledTrades).toHaveBeenCalledTimes(1);
    });
  });
});
