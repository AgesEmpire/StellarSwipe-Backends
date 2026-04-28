jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { Webhook } from './entities/webhook.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { SignatureGeneratorService } from './services/signature-generator.service';
import { WebhookSenderService } from './services/webhook-sender.service';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let webhookRepo: any;
  let deliveryRepo: any;
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
      findAndCount: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    deliveryRepo = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
    };

    signatureGenerator = {
      generateSecret: jest.fn().mockReturnValue('secret-abc'),
      generateSignature: jest.fn(),
      generateDeliveryId: jest.fn(),
      verifySignature: jest.fn(),
    } as any;

    webhookSender = {
      deliverWebhook: jest.fn().mockResolvedValue(undefined),
      retryDelivery: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: getRepositoryToken(Webhook), useValue: webhookRepo },
        { provide: getRepositoryToken(WebhookDelivery), useValue: deliveryRepo },
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
      const dto = { url: 'https://example.com/hook', events: ['trade.executed'] };
      const saved = { id: 'wh-1', userId, ...dto, secret: 'secret-abc', active: true };
      webhookRepo.create.mockReturnValue(saved);
      webhookRepo.save.mockResolvedValue(saved);

      const result = await service.register(userId, dto as any);

      expect(signatureGenerator.generateSecret).toHaveBeenCalled();
      expect(result.secret).toBe('secret-abc');
    });

    it('rejects unsupported event types', async () => {
      const dto = { url: 'https://example.com/hook', events: ['unknown.event'] };
      await expect(service.register(userId, dto as any)).rejects.toThrow(BadRequestException);
    });

    it('accepts all supported event types', async () => {
      const supportedEvents = [
        'trade.executed', 'trade.failed', 'trade.cancelled',
        'signal.created', 'signal.validated', 'signal.performance.updated',
        'contest.updated', 'payout.completed',
      ];
      const dto = { url: 'https://example.com/hook', events: supportedEvents };
      const saved = { id: 'wh-1', userId, ...dto, secret: 'secret-abc', active: true };
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
      await expect(service.findOne(userId, 'wh-1')).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException for wrong owner', async () => {
      webhookRepo.findOne.mockResolvedValue({ id: 'wh-1', userId: 'other-user' });
      await expect(service.findOne(userId, 'wh-1')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('dispatchEvent', () => {
    it('dispatches to all active webhooks subscribed to event', async () => {
      const webhooks = [
        { id: 'wh-1', userId, url: 'https://a.com', events: ['trade.executed'], secret: 's1', active: true },
        { id: 'wh-2', userId, url: 'https://b.com', events: ['trade.executed'], secret: 's2', active: true },
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
});
