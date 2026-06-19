import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationProcessor } from './notification.processor';
import { Notification, NotificationStatus } from './entities/notification.entity';
import { DeadLetterService } from '../jobs/dead-letter.service';

const makeJob = (overrides: Partial<{ data: unknown; attemptsMade: number; opts: { attempts?: number } }> = {}) => ({
  id: 'job-1',
  data: overrides.data ?? { notificationId: 'notif-1' },
  attemptsMade: overrides.attemptsMade ?? 1,
  opts: overrides.opts ?? { attempts: 3 },
});

describe('NotificationProcessor', () => {
  let processor: NotificationProcessor;
  let notificationRepository: any;
  let deadLetterService: any;

  beforeEach(async () => {
    notificationRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    deadLetterService = {
      capture: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationProcessor,
        { provide: getRepositoryToken(Notification), useValue: notificationRepository },
        { provide: DeadLetterService, useValue: deadLetterService },
      ],
    }).compile();

    processor = module.get(NotificationProcessor);
    jest.spyOn((processor as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((processor as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((processor as any).logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  describe('handleDeliver', () => {
    it('marks notification as SENT on successful delivery', async () => {
      const notification = { id: 'notif-1', channel: 'in_app', userId: 'u1', status: NotificationStatus.PENDING };
      notificationRepository.findOne.mockResolvedValue(notification);
      notificationRepository.save.mockResolvedValue(notification);

      await processor.handleDeliver(makeJob() as any);

      expect(notification.status).toBe(NotificationStatus.SENT);
      expect(notificationRepository.save).toHaveBeenCalledWith(notification);
    });

    it('does nothing when the notification record is missing', async () => {
      notificationRepository.findOne.mockResolvedValue(null);

      await processor.handleDeliver(makeJob() as any);

      expect(notificationRepository.save).not.toHaveBeenCalled();
    });

    it('marks notification FAILED and rethrows so Bull can retry', async () => {
      const notification = { id: 'notif-1', channel: 'in_app', userId: 'u1', status: NotificationStatus.PENDING };
      notificationRepository.findOne.mockResolvedValue(notification);
      notificationRepository.save
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce(notification);

      await expect(processor.handleDeliver(makeJob() as any)).rejects.toThrow('db down');
      expect(notification.status).toBe(NotificationStatus.FAILED);
    });
  });

  describe('onFailed', () => {
    it('captures to the dead-letter queue once retry attempts are exhausted', async () => {
      const job = makeJob({ attemptsMade: 3, opts: { attempts: 3 } });
      await processor.onFailed(job as any, new Error('smtp unreachable'));

      expect(deadLetterService.capture).toHaveBeenCalledWith(job, expect.any(Error));
    });

    it('does not capture to the dead-letter queue while retries remain', async () => {
      const job = makeJob({ attemptsMade: 1, opts: { attempts: 3 } });
      await processor.onFailed(job as any, new Error('transient'));

      expect(deadLetterService.capture).not.toHaveBeenCalled();
    });
  });
});
