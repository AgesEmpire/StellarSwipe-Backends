jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { Webhook } from './entities/webhook.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhookReplayAudit } from './entities/webhook-replay-audit.entity';
import { SignatureGeneratorService } from './services/signature-generator.service';
import { WebhookSenderService } from './services/webhook-sender.service';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let webhookRepo: any;
  let deliveryRepo: any;
  let replayAuditRepo: any;
  let signatureGenerator: jest.Mocked<SignatureGeneratorService>;
  let webhookSender: jest.Mocked<WebhookSenderService>;

  const userId = 'user-123';

  beforeEach(async () => {
    webhookRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      remove: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findAndCount: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    deliveryRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
    };

    replayAuditRepo = {
      create: jest.fn((entry) => entry),
      save: jest.fn(async (entry) => ({ id: 'audit-1', ...entry })),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn(),
    };

    signatureGenerator = {
      generateSecret: jest.fn().mockReturnValue('secret-abc'),
      generateSignature: jest.fn(),
      generateDeliveryId: jest.fn(),
      verifySignature: jest.fn(),
    } as any;

    webhookSender = {
      deliverWebhook: jest.fn().mockResolvedValue({ id: 'replay-delivery-1' }),
      retryDelivery: jest.fn().mockResolvedValue(undefined),
      sendVerificationChallenge: jest.fn().mockResolvedValue(true),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: getRepositoryToken(Webhook), useValue: webhookRepo },
        {
          provide: getRepositoryToken(WebhookDelivery),
          useValue: deliveryRepo,
        },
        {
          provide: getRepositoryToken(WebhookReplayAudit),
          useValue: replayAuditRepo,
        },
        { provide: SignatureGeneratorService, useValue: signatureGenerator },
        { provide: WebhookSenderService, useValue: webhookSender },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  describe('register', () => {
    it('creates webhook with HMAC secret', async () => {
      const dto = {
        url: 'https://example.com/hook',
        events: ['trade.executed'],
      };
      const saved = {
        id: 'wh-1',
        userId,
        ...dto,
        secret: 'secret-abc',
        active: true,
      };
      webhookRepo.create.mockReturnValue(saved);
      webhookRepo.save.mockResolvedValue(saved);

      const result = await service.register(userId, dto as any);

      expect(signatureGenerator.generateSecret).toHaveBeenCalled();
      expect(result.secret).toBe('secret-abc');
    });

    it('rejects unsupported event types', async () => {
      const dto = {
        url: 'https://example.com/hook',
        events: ['unknown.event'],
      };
      await expect(service.register(userId, dto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('accepts all supported event types', async () => {
      const supportedEvents = [
        'trade.executed',
        'trade.failed',
        'trade.cancelled',
        'signal.created',
        'signal.validated',
        'signal.performance.updated',
        'contest.updated',
        'payout.completed',
      ];
      const dto = { url: 'https://example.com/hook', events: supportedEvents };
      const saved = {
        id: 'wh-1',
        userId,
        ...dto,
        secret: 'secret-abc',
        active: true,
      };
      webhookRepo.create.mockReturnValue(saved);
      webhookRepo.save.mockResolvedValue(saved);

      await expect(service.register(userId, dto as any)).resolves.toBeDefined();
    });
  });

  describe('findOne', () => {
    it('returns webhook for owner', async () => {
      const webhook = { id: 'wh-1', userId };
      webhookRepo.findOne.mockResolvedValue(webhook);
      const result = await service.findOne(userId, 'wh-1');
      expect(result).toEqual(webhook);
    });

    it('throws NotFoundException for missing webhook', async () => {
      webhookRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne(userId, 'wh-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException for wrong owner', async () => {
      webhookRepo.findOne.mockResolvedValue({
        id: 'wh-1',
        userId: 'other-user',
      });
      await expect(service.findOne(userId, 'wh-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('dispatchEvent', () => {
    it('dispatches to all active webhooks subscribed to event', async () => {
      const webhooks = [
        {
          id: 'wh-1',
          userId,
          url: 'https://a.com',
          events: ['trade.executed'],
          secret: 's1',
          active: true,
        },
        {
          id: 'wh-2',
          userId,
          url: 'https://b.com',
          events: ['trade.executed'],
          secret: 's2',
          active: true,
        },
      ];

      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(webhooks),
      };
      webhookRepo.createQueryBuilder.mockReturnValue(qb);

      await service.dispatchEvent('trade.executed', { tradeId: 't1' });

      expect(webhookSender.deliverWebhook).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no webhooks are subscribed', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      webhookRepo.createQueryBuilder.mockReturnValue(qb);

      await service.dispatchEvent('trade.executed', {});

      expect(webhookSender.deliverWebhook).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes webhook for owner', async () => {
      const webhook = { id: 'wh-1', userId };
      webhookRepo.findOne.mockResolvedValue(webhook);
      webhookRepo.remove.mockResolvedValue(undefined);

      await service.remove(userId, 'wh-1');

      expect(webhookRepo.remove).toHaveBeenCalledWith(webhook);
    });
  });

  describe('replayToSubscriber', () => {
    const delivery = {
      id: 'd-1',
      eventType: 'signal.created',
      eventId: 'evt-1',
      webhook: { id: 'wh-source', userId },
      payload: {
        event: 'signal.created',
        deliveryId: 'd-orig',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: {},
      },
    };
    const webhook = {
      id: 'wh-1',
      userId,
      secret: 's1',
      url: 'https://example.com',
      active: true,
      events: ['signal.created'],
      consecutiveFailures: 0,
    };

    it('replays event to named subscriber and records a queued audit', async () => {
      deliveryRepo.findOne.mockResolvedValue(delivery);
      webhookRepo.findOne.mockResolvedValue(webhook);

      const audit = await service.replayToSubscriber(userId, 'd-1', 'wh-1');

      expect(webhookSender.deliverWebhook).toHaveBeenCalledWith(
        webhook,
        expect.objectContaining({ isReplay: true, originalDeliveryId: 'd-1' }),
      );
      expect(audit).toEqual(
        expect.objectContaining({
          requestedBy: userId,
          originalDeliveryId: 'd-1',
          targetWebhookId: 'wh-1',
          replayDeliveryId: 'replay-delivery-1',
          outcome: 'queued',
        }),
      );
    });

    it('denies and audits replay of an unknown delivery', async () => {
      deliveryRepo.findOne.mockResolvedValue(null);
      await expect(
        service.replayToSubscriber(userId, 'd-missing', 'wh-1'),
      ).rejects.toThrow(NotFoundException);
      expect(replayAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'denied' }),
      );
    });

    it("denies and audits replay of another user's delivery", async () => {
      deliveryRepo.findOne.mockResolvedValue({
        ...delivery,
        webhook: { id: 'wh-other', userId: 'other-user' },
      });

      await expect(
        service.replayToSubscriber(userId, 'd-1', 'wh-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(webhookSender.deliverWebhook).not.toHaveBeenCalled();
      expect(replayAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: 'denied',
          reason: 'Delivery belongs to another user',
        }),
      );
    });

    it('denies and audits replay to an unknown subscriber webhook', async () => {
      deliveryRepo.findOne.mockResolvedValue(delivery);
      webhookRepo.findOne.mockResolvedValue(null);
      await expect(
        service.replayToSubscriber(userId, 'd-1', 'wh-unknown'),
      ).rejects.toThrow(NotFoundException);
      expect(webhookSender.deliverWebhook).not.toHaveBeenCalled();
      expect(replayAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'denied' }),
      );
    });

    it('rejects and audits a duplicate replay within the window', async () => {
      deliveryRepo.findOne.mockResolvedValue(delivery);
      webhookRepo.findOne.mockResolvedValue(webhook);
      replayAuditRepo.findOne.mockResolvedValue({ id: 'audit-prev' });

      await expect(
        service.replayToSubscriber(userId, 'd-1', 'wh-1'),
      ).rejects.toThrow(ConflictException);
      expect(webhookSender.deliverWebhook).not.toHaveBeenCalled();
      expect(replayAuditRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'duplicate' }),
      );
    });
  });

  describe('getReplayAudits', () => {
    it('returns replay audits with the replayed delivery outcome', async () => {
      webhookRepo.findOne.mockResolvedValue({ id: 'wh-1', userId });
      replayAuditRepo.findAndCount.mockResolvedValue([
        [
          { id: 'a-1', outcome: 'queued', replayDeliveryId: 'rd-1' },
          { id: 'a-2', outcome: 'duplicate' },
        ],
        2,
      ]);
      deliveryRepo.find.mockResolvedValue([{ id: 'rd-1', status: 'success' }]);

      const result = await service.getReplayAudits(userId, 'wh-1');

      expect(result.total).toBe(2);
      expect(result.replays).toEqual([
        expect.objectContaining({ id: 'a-1', deliveryStatus: 'success' }),
        expect.objectContaining({ id: 'a-2', deliveryStatus: null }),
      ]);
    });

    it("rejects querying another user's webhook", async () => {
      webhookRepo.findOne.mockResolvedValue({ id: 'wh-1', userId: 'other' });
      await expect(service.getReplayAudits(userId, 'wh-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
  describe('event filters', () => {
    const queryBuilderReturning = (webhooks: unknown[]) => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(webhooks),
      };
      webhookRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    };

    it('stores a de-duplicated event filter on registration', async () => {
      webhookRepo.create.mockImplementation((w: unknown) => w);
      webhookRepo.save.mockImplementation(async (w: unknown) => w);

      const result = await service.register(userId, {
        url: 'https://example.com/hook',
        events: ['trade.executed', 'trade.executed', 'signal.created'],
      } as any);

      expect(result.events).toEqual(['trade.executed', 'signal.created']);
    });

    it('replaces the filter on update', async () => {
      webhookRepo.findOne.mockResolvedValue({
        id: 'wh-1',
        userId,
        events: ['trade.executed'],
      });
      webhookRepo.save.mockImplementation(async (w: unknown) => w);

      const result = await service.update(userId, 'wh-1', {
        events: ['payout.completed'],
      } as any);

      expect(result.events).toEqual(['payout.completed']);
    });

    it('rejects filter updates with events outside the registry', async () => {
      webhookRepo.findOne.mockResolvedValue({
        id: 'wh-1',
        userId,
        events: ['trade.executed'],
      });

      await expect(
        service.update(userId, 'wh-1', {
          events: ['trade.executed', 'not.an.event'],
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(webhookRepo.save).not.toHaveBeenCalled();
    });

    it('does not queue events excluded by the filter', async () => {
      queryBuilderReturning([
        { id: 'wh-1', events: ['trade.executed'], active: true },
        { id: 'wh-2', events: ['signal.created'], active: true },
      ]);

      await service.dispatchEvent('trade.executed', {});

      expect(webhookSender.deliverWebhook).toHaveBeenCalledTimes(1);
      expect(webhookSender.deliverWebhook).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'wh-1' }),
        expect.objectContaining({ event: 'trade.executed' }),
      );
    });

    it('delivers mandatory security events regardless of the filter', async () => {
      const qb = queryBuilderReturning([
        { id: 'wh-1', events: ['trade.executed'], active: true },
      ]);

      await service.dispatchEvent('webhook.secret.rotated', {});

      expect(qb.andWhere).not.toHaveBeenCalled();
      expect(webhookSender.deliverWebhook).toHaveBeenCalledTimes(1);
    });

    it('notifies the webhook of secret rotation even when filtered out', async () => {
      const webhook = {
        id: 'wh-1',
        userId,
        events: ['trade.executed'],
        active: true,
      };
      webhookRepo.findOne.mockResolvedValue(webhook);
      webhookRepo.save.mockImplementation(async (w: unknown) => w);

      await service.initiateSecretRotation(userId, 'wh-1', 1000);
      await service.finalizeSecretRotation(userId, 'wh-1');

      expect(webhookSender.deliverWebhook).toHaveBeenNthCalledWith(
        1,
        webhook,
        expect.objectContaining({ event: 'webhook.secret.rotation_started' }),
      );
      expect(webhookSender.deliverWebhook).toHaveBeenNthCalledWith(
        2,
        webhook,
        expect.objectContaining({ event: 'webhook.secret.rotated' }),
      );
    });
  });
  describe('secret rotation logging', () => {
    it('never writes raw secrets to logs', async () => {
      const logSpy = jest.spyOn((service as any).logger, 'log');
      const webhook = { id: 'wh-1', userId, secret: 'current-secret-value' };
      webhookRepo.findOne.mockResolvedValue(webhook);
      webhookRepo.save.mockImplementation(async (w: unknown) => w);
      signatureGenerator.generateSecret.mockReturnValue('rotated-secret-value');

      await service.initiateSecretRotation(userId, 'wh-1', 1000);
      await service.finalizeSecretRotation(userId, 'wh-1');

      const logged = JSON.stringify(logSpy.mock.calls);
      expect(logSpy).toHaveBeenCalled();
      expect(logged).not.toContain('current-secret-value');
      expect(logged).not.toContain('rotated-secret-value');
    });
  });
});
