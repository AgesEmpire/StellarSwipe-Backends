import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bull';
import { Queue } from 'bull';
import { DigestService } from './digest.service';
import {
  Notification,
  NotificationChannel,
  NotificationPriority,
  NotificationStatus,
  NotificationType,
} from '../entities/notification.entity';
import { PreferencesService } from '../preferences/preferences.service';
import { I18nAppService } from '../../i18n/i18n.service';
import { NOTIFICATION_QUEUE } from '../notification.service';

describe('DigestService', () => {
  let service: DigestService;
  let mockRepository: any;
  let mockQueue: jest.Mocked<Partial<Queue>>;
  let mockI18n: jest.Mocked<Partial<I18nAppService>>;

  beforeEach(async () => {
    mockRepository = {
      find: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'digest-1', ...v })),
      update: jest.fn(),
    };
    mockQueue = { add: jest.fn() };
    mockI18n = {
      translate: jest.fn(async (key: string) =>
        key.endsWith('DIGEST_TITLE') ? 'You have updates' : 'Grouped updates summary',
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DigestService,
        { provide: getRepositoryToken(Notification), useValue: mockRepository },
        { provide: getQueueToken(NOTIFICATION_QUEUE), useValue: mockQueue },
        { provide: PreferencesService, useValue: { findPreferencesDueForDigest: jest.fn() } },
        { provide: I18nAppService, useValue: mockI18n },
      ],
    }).compile();

    service = module.get(DigestService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns null and does not queue anything when there is nothing pending', async () => {
    mockRepository.find.mockResolvedValue([]);

    const result = await service.sendDigestForUser('user-1');

    expect(result).toBeNull();
    expect(mockQueue.add).not.toHaveBeenCalled();
    expect(mockRepository.save).not.toHaveBeenCalled();
  });

  it('bundles pending low-priority items into one digest and marks them as digested/sent', async () => {
    const pending = [
      {
        id: 'n-1',
        userId: 'user-1',
        type: NotificationType.SIGNAL_CREATED,
        channel: NotificationChannel.IN_APP,
        priority: NotificationPriority.LOW,
        digestedAt: null,
      },
      {
        id: 'n-2',
        userId: 'user-1',
        type: NotificationType.PRICE_ALERT,
        channel: NotificationChannel.IN_APP,
        priority: NotificationPriority.LOW,
        digestedAt: null,
      },
    ];
    mockRepository.find.mockResolvedValue(pending);

    const result = await service.sendDigestForUser('user-1', 'en');

    expect(result).toEqual(expect.objectContaining({ id: 'digest-1', userId: 'user-1' }));
    expect(result?.priority).toBe(NotificationPriority.URGENT);
    expect(result?.metadata).toEqual(
      expect.objectContaining({ digest: true, itemCount: 2, itemIds: ['n-1', 'n-2'] }),
    );

    // Bundled items marked digested + sent so they're never delivered on their own.
    expect(mockRepository.update).toHaveBeenCalledWith(
      ['n-1', 'n-2'],
      expect.objectContaining({ status: NotificationStatus.SENT }),
    );

    // The digest itself is queued exactly once.
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith('deliver', { notificationId: 'digest-1' }, expect.any(Object));
  });

  it('only considers low-priority, non-digested, in-app notifications', async () => {
    mockRepository.find.mockResolvedValue([]);
    await service.sendDigestForUser('user-1');

    expect(mockRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          channel: NotificationChannel.IN_APP,
          priority: NotificationPriority.LOW,
        }),
      }),
    );
  });
});
