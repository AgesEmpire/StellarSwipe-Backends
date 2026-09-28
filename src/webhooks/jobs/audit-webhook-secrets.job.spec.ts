
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Webhook } from '../entities/webhook.entity';
import { AuditWebhookSecretsJob } from './audit-webhook-secrets.job';
import { NotificationService } from '../../notifications/notification.service';
import { DistributedLockService } from '../../common/services/distributed-lock.service';

describe('AuditWebhookSecretsJob', () => {
  let job: AuditWebhookSecretsJob;
  let mockWebhookRepo: any;
  let mockNotificationService: any;
  let mockLockService: jest.Mocked<Pick<DistributedLockService, 'withLock'>>;

  beforeEach(async () => {
    mockWebhookRepo = {
      find: jest.fn(),
    };

    mockNotificationService = {
      send: jest.fn().mockResolvedValue({}),
    };

    // Default: lock is always free, so `fn` runs immediately — matches the
    // pre-locking test behaviour for every existing assertion below.
    mockLockService = {
      withLock: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<any>) => ({
        ran: true,
        result: await fn(),
      })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditWebhookSecretsJob,
        { provide: getRepositoryToken(Webhook), useValue: mockWebhookRepo },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: DistributedLockService, useValue: mockLockService },
      ],
    }).compile();

    job = module.get<AuditWebhookSecretsJob>(AuditWebhookSecretsJob);
    jest.spyOn((job as any).logger, 'log').mockImplementation(() => {});
    jest.spyOn((job as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((job as any).logger, 'error').mockImplementation(() => {});
    jest.spyOn((job as any).logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  it('should classify a strong secret correctly', async () => {
    // 64-char hex string from crypto.randomBytes(32).toString('hex')
    const strongSecret = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
    mockWebhookRepo.find.mockResolvedValue([
      { id: 'wh-strong', userId: 'user-1', secret: strongSecret } as Webhook,
    ]);

    await job.audit();

    expect((job as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('strong: 1'),
    );
    expect((job as any).logger.warn).not.toHaveBeenCalled();
    expect(mockNotificationService.send).not.toHaveBeenCalled();
  });

  it('should classify a weak secret correctly', async () => {
    const weakSecret = 'short';
    mockWebhookRepo.find.mockResolvedValue([
      { id: 'wh-weak', userId: 'user-2', secret: weakSecret } as Webhook,
    ]);

    await job.audit();

    expect((job as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Webhook wh-weak'),
    );
    expect((job as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('weak: 1'),
    );
    expect(mockNotificationService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-2',
        type: 'SYSTEM',
        title: 'Webhook Secret Rotation Required',
      }),
    );
  });

  it('should handle low-entropy secret of sufficient length', async () => {
    // 32 chars, all 'a' — low entropy
    const lowEntropySecret = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    mockWebhookRepo.find.mockResolvedValue([
      { id: 'wh-low-entropy', userId: 'user-3', secret: lowEntropySecret } as Webhook,
    ]);

    await job.audit();

    expect((job as any).logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('wh-low-entropy'),
    );
    expect((job as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('weak: 1'),
    );
  });

  it('should handle empty webhook set gracefully', async () => {
    mockWebhookRepo.find.mockResolvedValue([]);

    await job.audit();

    expect((job as any).logger.log).toHaveBeenCalledWith(
      expect.stringContaining('No webhooks found'),
    );
  });

  it('should not notify for secrets that meet requirements', async () => {
    const strongSecret = 'A'.repeat(64); // 64 chars, all same — length ok but low entropy
    mockWebhookRepo.find.mockResolvedValue([
      { id: 'wh-test', userId: 'user-4', secret: strongSecret } as Webhook,
    ]);

    await job.audit();

    // This should still trigger a warning due to low entropy
    expect((job as any).logger.warn).toHaveBeenCalled();
    expect(mockNotificationService.send).toHaveBeenCalled();
  });

  describe('distributed locking', () => {
    it('acquires the audit lock with the expected key and TTL', async () => {
      mockWebhookRepo.find.mockResolvedValue([]);

      await job.audit();

      expect(mockLockService.withLock).toHaveBeenCalledWith(
        'webhooks:audit-webhook-secrets',
        expect.any(Number),
        expect.any(Function),
      );
    });

    it('skips the run entirely when another instance already holds the lock (contention)', async () => {
      mockLockService.withLock.mockResolvedValue({ ran: false });

      await job.audit();

      expect(mockWebhookRepo.find).not.toHaveBeenCalled();
      expect(mockNotificationService.send).not.toHaveBeenCalled();
      expect((job as any).logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('lock held by another instance'),
      );
    });

    it('propagates errors from the audit body so the lock wrapper can still release it (failure recovery)', async () => {
      mockWebhookRepo.find.mockRejectedValue(new Error('db unavailable'));
      mockLockService.withLock.mockImplementation(async (_key, _ttl, fn) => {
        try {
          return { ran: true, result: await fn() };
        } finally {
          // Simulates DistributedLockService's own finally-release semantics.
        }
      });

      await expect(job.audit()).rejects.toThrow('db unavailable');
      expect(mockLockService.withLock).toHaveBeenCalledTimes(1);
    });
  });
});
