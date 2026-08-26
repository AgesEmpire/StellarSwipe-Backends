import { BadRequestException } from '@nestjs/common';
import { SignatureGeneratorService } from './signature-generator.service';
import { WebhooksService } from '../webhooks.service';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Webhook } from '../entities/webhook.entity';
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import { WebhookSenderService } from './webhook-sender.service';

describe('Webhook signing-secret rotation (issue #1030)', () => {
  describe('SignatureGeneratorService', () => {
    let svc: SignatureGeneratorService;

    beforeEach(() => {
      svc = new SignatureGeneratorService();
    });

    const makeWebhook = (
      overrides: Partial<{
        secret: string;
        nextSecret?: string;
        rotationStartedAt?: Date;
        rotationFinalizesAt?: Date;
      }> = {},
    ) => ({
      secret: 'current-secret-abc',
      ...overrides,
    });

    it('signs with the current secret when no rotation is in progress', () => {
      const webhook = makeWebhook();
      const payload = { event: 'trade.executed' };
      const sig = svc.signWithWebhookSecret(payload, webhook);
      expect(svc.verifySignature(payload, 'current-secret-abc', sig)).toBe(
        true,
      );
    });

    it('verifies with the current secret outside any rotation window', () => {
      const payload = { event: 'trade.executed' };
      const sig = svc.generateSignature(payload, 'current-secret-abc');
      const webhook = makeWebhook({ nextSecret: 'next-secret-xyz' });
      expect(svc.verifyWebhookSignature(payload, webhook, sig)).toBe(true);
    });

    it('accepts the previous secret during the overlap window', () => {
      const now = new Date();
      const payload = { event: 'payout.completed' };
      const oldSig = svc.generateSignature(payload, 'current-secret-abc');

      const webhook = makeWebhook({
        nextSecret: 'next-secret-xyz',
        rotationStartedAt: new Date(now.getTime() - 1000),
        rotationFinalizesAt: new Date(now.getTime() + 3600_000),
      });

      // Old signature (signed with current) must be accepted during overlap
      expect(svc.verifyWebhookSignature(payload, webhook, oldSig)).toBe(true);
    });

    it('accepts the new secret during the overlap window', () => {
      const now = new Date();
      const payload = { event: 'payout.completed' };
      const newSig = svc.generateSignature(payload, 'next-secret-xyz');

      const webhook = makeWebhook({
        nextSecret: 'next-secret-xyz',
        rotationStartedAt: new Date(now.getTime() - 1000),
        rotationFinalizesAt: new Date(now.getTime() + 3600_000),
      });

      // New signature must also be accepted during overlap
      expect(svc.verifyWebhookSignature(payload, webhook, newSig)).toBe(true);
    });

    it('rejects the previous secret after the rotation window expires', () => {
      const past = new Date(Date.now() - 3600_000);
      const payload = { event: 'signal.created' };
      const oldSig = svc.generateSignature(payload, 'current-secret-abc');

      const webhook = makeWebhook({
        secret: 'next-secret-xyz', // rotation already finalized
        nextSecret: undefined,
        rotationStartedAt: undefined,
        rotationFinalizesAt: undefined,
      });

      expect(svc.verifyWebhookSignature(payload, webhook, oldSig)).toBe(false);
    });

    it('rejects invalid signatures', () => {
      const payload = { event: 'trade.failed' };
      const webhook = makeWebhook();
      expect(
        svc.verifyWebhookSignature(payload, webhook, 'bad-signature'),
      ).toBe(false);
    });

    it('initiateRotation creates a new nextSecret and sets window', () => {
      const webhook = makeWebhook();
      const rotated = svc.initiateRotation(webhook, 3600_000);

      expect(rotated.nextSecret).toBeDefined();
      expect(rotated.nextSecret).not.toBe(webhook.secret);
      expect(rotated.rotationStartedAt).toBeDefined();
      expect(rotated.rotationFinalizesAt).toBeDefined();
      expect(rotated.rotationFinalizesAt!.getTime()).toBeGreaterThan(
        rotated.rotationStartedAt!.getTime(),
      );
    });

    it('finalizeRotation promotes nextSecret to current and clears window', () => {
      const webhook = makeWebhook({
        nextSecret: 'next-secret-xyz',
        rotationStartedAt: new Date(),
        rotationFinalizesAt: new Date(Date.now() + 3600_000),
      });

      const finalized = svc.finalizeRotation(webhook);

      expect(finalized.secret).toBe('next-secret-xyz');
      expect(finalized.nextSecret).toBeUndefined();
      expect(finalized.rotationStartedAt).toBeUndefined();
      expect(finalized.rotationFinalizesAt).toBeUndefined();
    });
  });

  describe('WebhooksService.initiateSecretRotation / finalizeSecretRotation', () => {
    let service: WebhooksService;
    let webhookRepo: any;

    const userId = 'user-1';
    const webhookId = 'wh-1';

    beforeEach(async () => {
      webhookRepo = {
        create: jest.fn(),
        save: jest.fn().mockImplementation((w) => Promise.resolve(w)),
        find: jest.fn(),
        findOne: jest.fn(),
        remove: jest.fn(),
        findAndCount: jest.fn(),
        createQueryBuilder: jest.fn(),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhooksService,
          { provide: getRepositoryToken(Webhook), useValue: webhookRepo },
          {
            provide: getRepositoryToken(WebhookDelivery),
            useValue: { findOne: jest.fn(), findAndCount: jest.fn() },
          },
          {
            provide: SignatureGeneratorService,
            useValue: {
              generateSecret: jest.fn().mockReturnValue('new-generated-secret'),
              generateSignature: jest.fn(),
              verifySignature: jest.fn(),
              verifyWebhookSignature: jest.fn(),
            },
          },
          {
            provide: WebhookSenderService,
            useValue: { deliverWebhook: jest.fn(), retryDelivery: jest.fn() },
          },
        ],
      }).compile();

      service = module.get<WebhooksService>(WebhooksService);
    });

    it('initiateSecretRotation sets nextSecret and rotation window', async () => {
      const webhook = {
        id: webhookId,
        userId,
        secret: 'old-secret',
        nextSecret: undefined,
        active: true,
        events: ['trade.executed'],
      };
      webhookRepo.findOne.mockResolvedValue(webhook);

      await service.initiateSecretRotation(userId, webhookId, 3600_000);

      expect(webhook.nextSecret).toBe('new-generated-secret');
      expect(webhook.rotationStartedAt).toBeDefined();
      expect(webhook.rotationFinalizesAt).toBeDefined();
    });

    it('finalizeSecretRotation promotes nextSecret and clears the window', async () => {
      const now = new Date();
      const webhook = {
        id: webhookId,
        userId,
        secret: 'old-secret',
        nextSecret: 'new-generated-secret',
        rotationStartedAt: now,
        rotationFinalizesAt: new Date(now.getTime() + 3600_000),
        active: true,
        events: ['trade.executed'],
      };
      webhookRepo.findOne.mockResolvedValue(webhook);

      await service.finalizeSecretRotation(userId, webhookId);

      expect(webhook.secret).toBe('new-generated-secret');
      expect(webhook.nextSecret).toBeUndefined();
      expect(webhook.rotationStartedAt).toBeUndefined();
      expect(webhook.rotationFinalizesAt).toBeUndefined();
    });

    it('throws BadRequestException when finalizing with no rotation in progress', async () => {
      const webhook = {
        id: webhookId,
        userId,
        secret: 'old-secret',
        nextSecret: undefined,
        active: true,
        events: [],
      };
      webhookRepo.findOne.mockResolvedValue(webhook);

      await expect(
        service.finalizeSecretRotation(userId, webhookId),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
