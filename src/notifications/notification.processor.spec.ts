import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationProcessor } from './notification.processor';
import {
  Notification,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from './entities/notification.entity';
import {
  NotificationDeliveryAuditLog,
} from './entities/notification-delivery-audit-log.entity';
import { ConsentCategory } from './entities/user-consent.entity';
import { ConsentService } from './consent.service';
import { DeadLetterService } from '../jobs/dead-letter.service';

const makeJob = (
  overrides: Partial<{
    data: unknown;
    attemptsMade: number;
    opts: { attempts?: number };
  }> = {},
) => ({
  id: 'job-1',
  data: overrides.data ?? { notificationId: 'notif-1' },
  attemptsMade: overrides.attemptsMade ?? 1,
  opts: overrides.opts ?? { attempts: 3 },
});

describe('NotificationProcessor', () => {
  let processor: NotificationProcessor;
  let notificationRepository: any;
  let auditRepository: any;
  let consentService: any;
  let deadLetterService: any;

  beforeEach(async () => {
    notificationRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    auditRepository = {
      create: jest.fn().mockImplementation((dto) => ({ ...dto })),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
    };
    consentService = {
      hasConsented: jest.fn().mockResolvedValue(false),
    };
    deadLetterService = {
      capture: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationProcessor,
        {
          provide: getRepositoryToken(Notification),
          useValue: notificationRepository,
        },
        {
          provide: getRepositoryToken(NotificationDeliveryAuditLog),
          useValue: auditRepository,
        },
        { provide: ConsentService, useValue: consentService },
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
      const notification = {
        id: 'notif-1',
        type: NotificationType.TRADE_EXECUTED,
        channel: NotificationChannel.IN_APP,
        userId: 'u1',
        status: NotificationStatus.PENDING,
      };
      notificationRepository.findOne.mockResolvedValue(notification);
      notificationRepository.save.mockResolvedValue(notification);

      await processor.handleDeliver(makeJob() as any);

      expect(notification.status).toBe(NotificationStatus.SENT);
      expect(notificationRepository.save).toHaveBeenCalledWith(notification);
      expect(auditRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          notificationId: 'notif-1',
          notificationType: NotificationType.TRADE_EXECUTED,
          channel: NotificationChannel.IN_APP,
          deliveredAt: expect.any(Date),
          skippedReason: null,
        }),
      );
    });

    it('does nothing when the notification record is missing', async () => {
      notificationRepository.findOne.mockResolvedValue(null);

      await processor.handleDeliver(makeJob() as any);

      expect(notificationRepository.save).not.toHaveBeenCalled();
      expect(auditRepository.save).not.toHaveBeenCalled();
    });

    it('marks notification FAILED and rethrows so Bull can retry', async () => {
      const notification = {
        id: 'notif-1',
        type: NotificationType.TRADE_EXECUTED,
        channel: NotificationChannel.IN_APP,
        userId: 'u1',
        status: NotificationStatus.PENDING,
      };
      notificationRepository.findOne.mockResolvedValue(notification);
      notificationRepository.save
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce(notification);

      await expect(
        processor.handleDeliver(makeJob() as any),
      ).rejects.toThrow('db down');
      expect(notification.status).toBe(NotificationStatus.FAILED);
    });

    it('delivers a marketing notification when the user has opted in', async () => {
      const notification = {
        id: 'notif-1',
        type: NotificationType.MARKETING,
        channel: NotificationChannel.EMAIL,
        userId: 'u1',
        status: NotificationStatus.PENDING,
      };
      notificationRepository.findOne.mockResolvedValue(notification);
      notificationRepository.save.mockResolvedValue(notification);
      consentService.hasConsented.mockResolvedValue(true);

      await processor.handleDeliver(makeJob() as any);

      expect(consentService.hasConsented).toHaveBeenCalledWith(
        'u1',
        ConsentCategory.MARKETING_EMAIL,
      );
      expect(notification.status).toBe(NotificationStatus.SENT);
      expect(auditRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveredAt: expect.any(Date),
          skippedReason: null,
        }),
      );
    });

    it('skips delivery and audits a marketing notification when opted out', async () => {
      const notification = {
        id: 'notif-1',
        type: NotificationType.MARKETING,
        channel: NotificationChannel.EMAIL,
        userId: 'u1',
        status: NotificationStatus.PENDING,
      };
      notificationRepository.findOne.mockResolvedValue(notification);
      consentService.hasConsented.mockResolvedValue(false);

      await processor.handleDeliver(makeJob() as any);

      expect(consentService.hasConsented).toHaveBeenCalledWith(
        'u1',
        ConsentCategory.MARKETING_EMAIL,
      );
      expect(notificationRepository.save).not.toHaveBeenCalled();
      expect(notification.status).toBe(NotificationStatus.PENDING);
      expect(auditRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          notificationId: 'notif-1',
          notificationType: NotificationType.MARKETING,
          channel: NotificationChannel.EMAIL,
          deliveredAt: null,
          skippedReason: expect.stringContaining(
            ConsentCategory.MARKETING_EMAIL,
          ),
        }),
      );
    });

    it('checks push consent for marketing notifications sent over push', async () => {
      const notification = {
        id: 'notif-1',
        type: NotificationType.MARKETING,
        channel: NotificationChannel.PUSH,
        userId: 'u1',
        status: NotificationStatus.PENDING,
      };
      notificationRepository.findOne.mockResolvedValue(notification);
      consentService.hasConsented.mockResolvedValue(false);

      await processor.handleDeliver(makeJob() as any);

      expect(consentService.hasConsented).toHaveBeenCalledWith(
        'u1',
        ConsentCategory.MARKETING_PUSH,
      );
      expect(notificationRepository.save).not.toHaveBeenCalled();
    });

    it('bypasses consent checks for mandatory notifications (trade confirmations)', async () => {
      const notification = {
        id: 'notif-1',
        type: NotificationType.TRADE_EXECUTED,
        channel: NotificationChannel.EMAIL,
        userId: 'u1',
        status: NotificationStatus.PENDING,
      };
      notificationRepository.findOne.mockResolvedValue(notification);
      notificationRepository.save.mockResolvedValue(notification);

      await processor.handleDeliver(makeJob() as any);

      expect(consentService.hasConsented).not.toHaveBeenCalled();
      expect(notification.status).toBe(NotificationStatus.SENT);
    });

    it('bypasses consent checks for security alerts', async () => {
      const notification = {
        id: 'notif-1',
        type: NotificationType.RISK_ALERT,
        channel: NotificationChannel.EMAIL,
        userId: 'u1',
        status: NotificationStatus.PENDING,
      };
      notificationRepository.findOne.mockResolvedValue(notification);
      notificationRepository.save.mockResolvedValue(notification);

      await processor.handleDeliver(makeJob() as any);

      expect(consentService.hasConsented).not.toHaveBeenCalled();
      expect(notification.status).toBe(NotificationStatus.SENT);
    });

    it('never consent-gates in-app marketing notifications', async () => {
      const notification = {
        id: 'notif-1',
        type: NotificationType.MARKETING,
        channel: NotificationChannel.IN_APP,
        userId: 'u1',
        status: NotificationStatus.PENDING,
      };
      notificationRepository.findOne.mockResolvedValue(notification);
      notificationRepository.save.mockResolvedValue(notification);

      await processor.handleDeliver(makeJob() as any);

      expect(consentService.hasConsented).not.toHaveBeenCalled();
      expect(notification.status).toBe(NotificationStatus.SENT);
    });
  });

  describe('onFailed', () => {
    it('captures to the dead-letter queue once retry attempts are exhausted', async () => {
      const job = makeJob({ attemptsMade: 3, opts: { attempts: 3 } });
      await processor.onFailed(job as any, new Error('smtp unreachable'));

      expect(deadLetterService.capture).toHaveBeenCalledWith(
        job,
        expect.any(Error),
      );
    });

    it('does not capture to the dead-letter queue while retries remain', async () => {
      const job = makeJob({ attemptsMade: 1, opts: { attempts: 3 } });
      await processor.onFailed(job as any, new Error('transient'));

      expect(deadLetterService.capture).not.toHaveBeenCalled();
    });
  });
});
