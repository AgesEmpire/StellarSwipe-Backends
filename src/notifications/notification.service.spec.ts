import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { Queue } from 'bull';
import { NotificationService, NOTIFICATION_QUEUE } from './notification.service';
import { Notification, NotificationChannel, NotificationType } from './entities/notification.entity';
import { PreferencesService } from './preferences/preferences.service';
import { ConsentService } from './consent.service';

describe('NotificationService.sendForEvent', () => {
  let service: NotificationService;
  let mockRepository: any;
  let mockQueue: jest.Mocked<Partial<Queue>>;
  let insertQueryBuilder: any;

  beforeEach(async () => {
    insertQueryBuilder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };

    mockRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(insertQueryBuilder),
      findOne: jest.fn(),
      findOneByOrFail: jest.fn(),
    };

    mockQueue = { add: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: getRepositoryToken(Notification), useValue: mockRepository },
        { provide: getQueueToken(NOTIFICATION_QUEUE), useValue: mockQueue },
        { provide: PreferencesService, useValue: {} },
        { provide: ConsentService, useValue: {} },
      ],
    }).compile();

    service = module.get(NotificationService);
  });

  afterEach(() => jest.clearAllMocks());

  const dto = {
    userId: 'user-1',
    type: NotificationType.TRADE_FAILED,
    title: 'Trade failed',
    message: 'Your trade failed',
    channel: NotificationChannel.IN_APP,
    metadata: { tradeId: 'trade-1' },
  };

  it('creates a notification and queues it for delivery on first insert', async () => {
    insertQueryBuilder.execute.mockResolvedValue({ raw: [{ id: 'notif-1' }], identifiers: [{ id: 'notif-1' }] });
    mockRepository.findOneByOrFail.mockResolvedValue({ id: 'notif-1', ...dto });

    const result = await service.sendForEvent('trade.failed:trade-1:corr-1', dto);

    expect(result.deduplicated).toBe(false);
    expect(result.notification.id).toBe('notif-1');
    expect(insertQueryBuilder.values).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'trade.failed:trade-1:corr-1' }),
    );
    expect(mockQueue.add).toHaveBeenCalledWith(
      'deliver',
      { notificationId: 'notif-1' },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('reuses the existing notification and does not re-queue delivery when the event id already exists', async () => {
    // ON CONFLICT DO NOTHING: nothing inserted.
    insertQueryBuilder.execute.mockResolvedValue({ raw: [], identifiers: [] });
    const existing = { id: 'notif-existing', ...dto };
    mockRepository.findOne.mockResolvedValue(existing);

    const result = await service.sendForEvent('trade.failed:trade-1:corr-1', dto);

    expect(result.deduplicated).toBe(true);
    expect(result.notification).toBe(existing);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('defers low-priority in-app notifications to the digest instead of queuing immediate delivery', async () => {
    insertQueryBuilder.execute.mockResolvedValue({ raw: [{ id: 'notif-2' }], identifiers: [{ id: 'notif-2' }] });
    mockRepository.findOneByOrFail.mockResolvedValue({
      id: 'notif-2',
      ...dto,
      type: NotificationType.SIGNAL_CREATED,
    });

    const result = await service.sendForEvent('signal.created:signal-1', {
      ...dto,
      type: NotificationType.SIGNAL_CREATED,
    });

    expect(result.deduplicated).toBe(false);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('throws if the insert was ignored but no existing notification can be found', async () => {
    insertQueryBuilder.execute.mockResolvedValue({ raw: [], identifiers: [] });
    mockRepository.findOne.mockResolvedValue(null);

    await expect(service.sendForEvent('trade.failed:trade-1:corr-1', dto)).rejects.toThrow(
      /no existing notification was found/,
    );
  });
});
