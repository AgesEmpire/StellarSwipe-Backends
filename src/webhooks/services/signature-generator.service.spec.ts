import { Test, TestingModule } from '@nestjs/testing';
import { SignatureGeneratorService, WebhookSecretState } from './signature-generator.service';

describe('SignatureGeneratorService', () => {
  let service: SignatureGeneratorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SignatureGeneratorService],
    }).compile();

    service = module.get<SignatureGeneratorService>(SignatureGeneratorService);
  });

  describe('signature generation and verification', () => {
    it('should generate and verify a valid signature', () => {
      const payload = { event: 'test.event', timestamp: '2024-01-01' };
      const secret = service.generateSecret();

      const signature = service.generateSignature(payload, secret);
      const isValid = service.verifySignature(payload, secret, signature);

      expect(isValid).toBe(true);
    });

    it('should reject an invalid signature', () => {
      const payload = { event: 'test.event' };
      const secret = service.generateSecret();
      const wrongSecret = service.generateSecret();

      const signature = service.generateSignature(payload, secret);
      const isValid = service.verifySignature(payload, wrongSecret, signature);

      expect(isValid).toBe(false);
    });
  });

  describe('webhook secret signing', () => {
    it('should sign payload with webhook current secret', () => {
      const payload = { data: 'test' };
      const webhook: WebhookSecretState = {
        secret: service.generateSecret(),
      };

      const signature = service.signWithWebhookSecret(payload, webhook);
      const isValid = service.verifySignature(payload, webhook.secret, signature);

      expect(isValid).toBe(true);
    });
  });

  describe('rotation window verification', () => {
    it('should verify signature with current secret outside rotation window', () => {
      const payload = { data: 'test' };
      const currentSecret = service.generateSecret();
      const nextSecret = service.generateSecret();
      const now = new Date();

      const webhook: WebhookSecretState = {
        secret: currentSecret,
        nextSecret,
        rotationStartedAt: new Date(now.getTime() - 7200000),
        rotationFinalizesAt: new Date(now.getTime() - 3600000),
      };

      const signature = service.generateSignature(payload, currentSecret);
      const isValid = service.verifyWebhookSignature(payload, webhook, signature);

      expect(isValid).toBe(true);
    });

    it('should accept signatures from both secrets during rotation window', () => {
      const payload = { data: 'test' };
      const currentSecret = service.generateSecret();
      const nextSecret = service.generateSecret();
      const now = new Date();

      const webhook: WebhookSecretState = {
        secret: currentSecret,
        nextSecret,
        rotationStartedAt: new Date(now.getTime() - 1800000),
        rotationFinalizesAt: new Date(now.getTime() + 1800000),
      };

      const currentSignature = service.generateSignature(payload, currentSecret);
      const nextSignature = service.generateSignature(payload, nextSecret);

      expect(service.verifyWebhookSignature(payload, webhook, currentSignature)).toBe(true);
      expect(service.verifyWebhookSignature(payload, webhook, nextSignature)).toBe(true);
    });

    it('should reject new secret signature outside rotation window', () => {
      const payload = { data: 'test' };
      const currentSecret = service.generateSecret();
      const nextSecret = service.generateSecret();
      const now = new Date();

      const webhook: WebhookSecretState = {
        secret: currentSecret,
        nextSecret,
        rotationStartedAt: new Date(now.getTime() - 7200000),
        rotationFinalizesAt: new Date(now.getTime() - 3600000),
      };

      const nextSignature = service.generateSignature(payload, nextSecret);
      const isValid = service.verifyWebhookSignature(payload, webhook, nextSignature);

      expect(isValid).toBe(false);
    });

    it('should reject invalid signature during rotation window', () => {
      const payload = { data: 'test' };
      const currentSecret = service.generateSecret();
      const nextSecret = service.generateSecret();
      const wrongSecret = service.generateSecret();
      const now = new Date();

      const webhook: WebhookSecretState = {
        secret: currentSecret,
        nextSecret,
        rotationStartedAt: new Date(now.getTime() - 1800000),
        rotationFinalizesAt: new Date(now.getTime() + 1800000),
      };

      const wrongSignature = service.generateSignature(payload, wrongSecret);
      const isValid = service.verifyWebhookSignature(payload, webhook, wrongSignature);

      expect(isValid).toBe(false);
    });
  });

  describe('rotation lifecycle', () => {
    it('should initiate rotation with new secret and window', () => {
      const webhook: WebhookSecretState = {
        secret: service.generateSecret(),
      };

      const rotationWindowMs = 3600000;
      const before = Date.now();
      const result = service.initiateRotation(webhook, rotationWindowMs);
      const after = Date.now();

      expect(result.nextSecret).toBeDefined();
      expect(result.nextSecret).not.toBe(webhook.secret);
      expect(result.rotationStartedAt).toBeDefined();
      expect(result.rotationFinalizesAt).toBeDefined();
      expect(result.rotationFinalizesAt!.getTime()).toBeGreaterThanOrEqual(before + rotationWindowMs);
      expect(result.rotationFinalizesAt!.getTime()).toBeLessThanOrEqual(after + rotationWindowMs);
    });

    it('should finalize rotation by promoting next secret', () => {
      const currentSecret = service.generateSecret();
      const nextSecret = service.generateSecret();
      const webhook: WebhookSecretState = {
        secret: currentSecret,
        nextSecret,
        rotationStartedAt: new Date(),
        rotationFinalizesAt: new Date(),
      };

      const result = service.finalizeRotation(webhook);

      expect(result.secret).toBe(nextSecret);
      expect(result.nextSecret).toBeUndefined();
      expect(result.rotationStartedAt).toBeUndefined();
      expect(result.rotationFinalizesAt).toBeUndefined();
    });

    it('should fallback to current secret if next secret not set during finalization', () => {
      const secret = service.generateSecret();
      const webhook: WebhookSecretState = {
        secret,
        rotationStartedAt: new Date(),
        rotationFinalizesAt: new Date(),
      };

      const result = service.finalizeRotation(webhook);

      expect(result.secret).toBe(secret);
      expect(result.nextSecret).toBeUndefined();
    });
  });
});
