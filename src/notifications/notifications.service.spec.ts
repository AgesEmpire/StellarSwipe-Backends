import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { NotificationsService } from './notifications.service';
import { Notification } from './entities/notification.entity';
import { NotificationType, NotificationChannel } from './entities/notification.entity';
import { Queue } from 'bull';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockRepository: any;
  let mockQueue: jest.Mocked<Partial<Queue>>;

  beforeEach(async () => {
    mockRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    mockQueue = {
      add: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(Notification), useValue: mockRepository },
        { provide: getQueueToken('notifications'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createAndQueueNotification', () => {
    it('should create and queue a notification', async () => {
      const notificationData = {
        userId: 'user-123',
        type: NotificationType.TRADE_EXECUTED,
        title: 'Test Notification',
        message: 'This is a test notification',
        channel: NotificationChannel.BOTH,
        metadata: { test: 'data' },
      };

      const savedNotification = {
        id: 'notification-123',
        ...notificationData,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepository.create.mockReturnValue(savedNotification);
      mockRepository.save.mockResolvedValue(savedNotification);
      mockQueue.add.mockResolvedValue(undefined);

      const result = await service.createAndQueueNotification(
        notificationData.userId,
        notificationData.type,
        notificationData.title,
        notificationData.message,
        notificationData.channel,
        notificationData.metadata,
      );

      expect(mockRepository.create).toHaveBeenCalledWith({
        userId: notificationData.userId,
        type: notificationData.type,
        title: notificationData.title,
        message: notificationData.message,
        channel: notificationData.channel,
        metadata: notificationData.metadata,
        status: 'PENDING',
      });
      expect(mockRepository.save).toHaveBeenCalledWith(savedNotification);
      expect(mockQueue.add).toHaveBeenCalledWith('send-notification', {
        notificationId: savedNotification.id,
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      });
      expect(result).toEqual(savedNotification);
    });
  });

  describe('findById', () => {
    it('should return notification by ID', async () => {
      const notification = {
        id: 'notification-123',
        userId: 'user-123',
        type: NotificationType.TRADE_EXECUTED,
        title: 'Test',
        message: 'Test message',
        channel: NotificationChannel.EMAIL,
        status: 'SENT',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockRepository.findOne.mockResolvedValue(notification);

      const result = await service.findById('notification-123');

      expect(mockRepository.findOne).toHaveBeenCalledWith({ where: { id: 'notification-123' } });
      expect(result).toEqual(notification);
    });

    it('should return null if notification not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should return notifications for user', async () => {
      const notifications = [
        {
          id: 'notification-1',
          userId: 'user-123',
          type: NotificationType.TRADE_EXECUTED,
          title: 'Test 1',
          message: 'Test message 1',
          channel: NotificationChannel.EMAIL,
          status: 'SENT',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'notification-2',
          userId: 'user-123',
          type: NotificationType.TRADE_CLOSED,
          title: 'Test 2',
          message: 'Test message 2',
          channel: NotificationChannel.PUSH,
          status: 'SENT',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockRepository.find.mockResolvedValue(notifications);

      const result = await service.findByUserId('user-123');

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        order: { createdAt: 'DESC' },
        take: 50,
        skip: 0,
      });
      expect(result).toEqual(notifications);
    });
  });

  describe('markAsSent', () => {
    it('should mark notification as sent', async () => {
      mockRepository.update.mockResolvedValue(undefined);

      await service.markAsSent('notification-123');

      expect(mockRepository.update).toHaveBeenCalledWith('notification-123', {
        status: 'SENT',
        sentAt: expect.any(Date),
      });
    });
  });

  describe('markAsFailed', () => {
    it('should mark notification as failed', async () => {
      mockRepository.update.mockResolvedValue(undefined);

      await service.markAsFailed('notification-123', 'Test error');

      expect(mockRepository.update).toHaveBeenCalledWith('notification-123', {
        status: 'FAILED',
        errorMessage: 'Test error',
      });
    });
  });
});

