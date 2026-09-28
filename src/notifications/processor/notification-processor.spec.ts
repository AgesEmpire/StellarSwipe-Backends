import { Test, TestingModule } from '@nestjs/testing';
import { NotificationProcessor } from './notification-processor';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { Notification } from '../entities/notification.entity';
import { NotificationPreference } from '../preferences/entities/notification-preference.entity';
import { NotificationType, NotificationChannel, NotificationStatus } from '../entities/notification.entity';
import { EmailService } from '../../email/email.service';
import { SmsService } from '../../sms/sms.service';
import { SocketManagerService } from '../../websocket/services/socket-manager.service';
import { Job } from 'bull';

describe('NotificationProcessor', () => {
  let processor: NotificationProcessor;
  let mockNotificationRepository: any;
  let mockPreferenceRepository: any;
  let mockEmailService: jest.Mocked<Partial<EmailService>>;
  let mockSmsService: jest.Mocked<Partial<SmsService>>;
  let mockSocketManagerService: jest.Mocked<Partial<SocketManagerService>>;

  beforeEach(async () => {
    mockNotificationRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    mockPreferenceRepository = {
      findOne: jest.fn(),
    };
    mockEmailService = {
      sendEmail: jest.fn(),
    };
    mockSmsService = {
      sendSms: jest.fn(),
    };
    mockSocketManagerService = {
      // We're not testing the actual socket emission in this unit test
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationProcessor,
        { provide: getRepositoryToken(Notification), useValue: mockNotificationRepository },
        { provide: getRepositoryToken(NotificationPreference), useValue: mockPreferenceRepository },
        { provide: EmailService, useValue: mockEmailService },
        { provide: SmsService, useValue: mockSmsService },
        { provide: SocketManagerService, useValue: mockSocketManagerService },
      ],
    }).compile();

    processor = module.get<NotificationProcessor>(NotificationProcessor);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processNotification', () => {
    const jobData = {
      notificationId: 'notification-123',
    };

    const notification = {
      id: 'notification-123',
      userId: 'user-123',
      type: NotificationType.TRADE_EXECUTED,
      title: 'Trade Executed',
      message: 'Your trade was successful',
      channel: NotificationChannel.BOTH,
      status: NotificationStatus.PENDING,
      metadata: {
        email: 'user@example.com',
        tradeId: 'trade-123',
        baseAsset: 'XLM',
        counterAsset: 'USDC',
        amount: '100',
      },
      retryCount: 0,
    };

    it('should process a notification successfully', async () => {
      const preferences = {
        userId: 'user-123',
        tradeUpdatesEmail: true,
        tradeUpdatesPush: true,
        signalPerformanceEmail: true,
        signalPerformancePush: true,
        systemAlertsEmail: true,
        systemAlertsPush: true,
        marketingEmail: false,
        marketingPush: false,
      };

      mockNotificationRepository.findOne.mockResolvedValue(notification);
      mockPreferenceRepository.findOne.mockResolvedValue(preferences);
      mockEmailService.sendEmail.mockResolvedValue(undefined);
      // Socket service would be called but we're not asserting on it in this test
      mockNotificationRepository.save.mockResolvedValue(undefined);

      // Mock the Bull job
      const mockJob = {
        data: jobData,
      } as unknown as Job<{ notificationId: string }>;

      await processor.processNotification(mockJob);

      expect(mockNotificationRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'notification-123' },
      });
      expect(mockPreferenceRepository.findOne).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
      });
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          template: 'trade-executed',
          variables: expect.objectContaining({
            tradeId: 'trade-123',
            baseAsset: 'XLM',
            counterAsset: 'USDC',
            amount: '100',
          }),
        })
      );
      // Check that notification was marked as sent
      expect(mockNotificationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: NotificationStatus.SENT,
          sentAt: expect.any(Date),
        })
      );
    });

    it('should skip notification if user preferences disable it', async () => {
      const preferences = {
        userId: 'user-123',
        tradeUpdatesEmail: false, // Disabled
        tradeUpdatesPush: false, // Disabled
        // ... other preferences
      };

      mockNotificationRepository.findOne.mockResolvedValue(notification);
      mockPreferenceRepository.findOne.mockResolvedValue(preferences);
      mockNotificationRepository.save.mockResolvedValue(undefined);

      const mockJob = {
        data: jobData,
      } as unknown as Job<{ notificationId: string }>;

      await processor.processNotification(mockJob);

      // Should not call email service since preferences are disabled
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
      // Should still mark as sent (even though we didn't actually send)
      expect(mockNotificationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: NotificationStatus.SENT,
        })
      );
    });

    it('should handle processing failure and retry', async () => {
      mockNotificationRepository.findOne.mockResolvedValue(notification);
      mockPreferenceRepository.findOne.mockResolvedValue({
        userId: 'user-123',
        tradeUpdatesEmail: true,
        tradeUpdatesPush: true,
        signalPerformanceEmail: true,
        signalPerformancePush: true,
        systemAlertsEmail: true,
        systemAlertsPush: true,
        marketingEmail: false,
        marketingPush: false,
      });
      mockEmailService.sendEmail.mockRejectedValue(new Error('Email service down'));
      mockNotificationRepository.save.mockResolvedValue(undefined);

      const mockJob = {
        data: jobData,
      } as unknown as Job<{ notificationId: string }>;

      await expect(processor.processNotification(mockJob)).rejects.toThrow('Email service down');

      // Should have marked as failed and incremented retry count
      expect(mockNotificationRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: NotificationStatus.FAILED,
          errorMessage: 'Email service down',
          retryCount: 1,
        })
      );
    });

    it('should handle notification not found', async () => {
      mockNotificationRepository.findOne.mockResolvedValue(null);

      const mockJob = {
        data: jobData,
      } as unknown as Job<{ notificationId: string }>;

      await expect(processor.processNotification(mockJob)).resolves.toBeUndefined();

      // Should not try to save anything
      expect(mockNotificationRepository.save).not.toHaveBeenCalled();
    });
  });
});

