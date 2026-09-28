import * as crypto from 'crypto';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookVerifierService } from './webhook-verifier.service';
import { DistributedLockService } from '../../common/services/distributed-lock.service';

describe('WebhookVerifierService', () => {
  const secrets: Record<string, string> = {
    WEBHOOK_SIGNING_KEY: 'generic-webhook-secret-at-least-32-chars',
    PAYSTACK_SECRET_KEY: 'paystack-secret-at-least-32-chars',
  };

  const makeConfig = (overrides: Record<string, string> = {}) => {
    const values = { ...secrets, ...overrides };
    return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
  };

  const makeLock = () => {
    const claimed = new Set<string>();
    return {
      acquire: jest.fn(async (key: string) => {
        if (claimed.has(key)) return null;
        claimed.add(key);
        return 'token';
      }),
    } as unknown as DistributedLockService;
  };

  describe('validate() — signature only', () => {
    let service: WebhookVerifierService;

    beforeEach(() => {
      service = new WebhookVerifierService(makeConfig(), makeLock());
    });

    it('validates a correct sha256 signature', () => {
      const body = JSON.stringify({ hello: 'world' });
      const signature =
        'sha256=' + crypto.createHmac('sha256', secrets.WEBHOOK_SIGNING_KEY).update(body).digest('hex');

      expect(service.validate(body, signature)).toBe(true);
    });

    it('validates provider-specific sha512 signatures', () => {
      const body = JSON.stringify({ event: 'charge.success' });
      const signature = crypto.createHmac('sha512', secrets.PAYSTACK_SECRET_KEY).update(body).digest('hex');

      expect(service.validate(body, signature, 'PAYSTACK_SECRET_KEY', 'sha512')).toBe(true);
    });

    it('rejects missing and malformed signatures with 401', () => {
      expect(() => service.validate('{"ok":true}', undefined)).toThrow(UnauthorizedException);
      expect(() => service.validate('{"ok":true}', 'sha256=not-hex')).toThrow(UnauthorizedException);
    });

    it('rejects when no secret is configured for the provider', () => {
      const noSecretService = new WebhookVerifierService(
        { get: jest.fn(() => undefined) } as unknown as ConfigService,
        makeLock(),
      );
      expect(() => noSecretService.validate('{"ok":true}', 'sha256=' + 'ab'.repeat(32))).toThrow(
        UnauthorizedException,
      );
    });

    describe('secret rotation', () => {
      it('accepts a signature produced with the previous secret when rotation is configured', () => {
        const rotatingService = new WebhookVerifierService(
          makeConfig({ WEBHOOK_SIGNING_KEY: 'new-secret-value,old-secret-value' }),
          makeLock(),
        );
        const body = JSON.stringify({ event: 'still.valid' });
        const oldSignature = 'sha256=' + crypto.createHmac('sha256', 'old-secret-value').update(body).digest('hex');

        expect(rotatingService.validate(body, oldSignature)).toBe(true);
      });

      it('accepts a signature produced with the new secret when rotation is configured', () => {
        const rotatingService = new WebhookVerifierService(
          makeConfig({ WEBHOOK_SIGNING_KEY: 'new-secret-value,old-secret-value' }),
          makeLock(),
        );
        const body = JSON.stringify({ event: 'still.valid' });
        const newSignature = 'sha256=' + crypto.createHmac('sha256', 'new-secret-value').update(body).digest('hex');

        expect(rotatingService.validate(body, newSignature)).toBe(true);
      });

      it('rejects a signature produced with a secret that has been fully retired', () => {
        const rotatingService = new WebhookVerifierService(
          makeConfig({ WEBHOOK_SIGNING_KEY: 'new-secret-value,old-secret-value' }),
          makeLock(),
        );
        const body = JSON.stringify({ event: 'retired' });
        const retiredSignature =
          'sha256=' + crypto.createHmac('sha256', 'retired-secret').update(body).digest('hex');

        expect(() => rotatingService.validate(body, retiredSignature)).toThrow(UnauthorizedException);
      });
    });
  });

  describe('validateRequest() — full pipeline', () => {
    it('uses the raw request body before falling back to serialized parsed body', async () => {
      const service = new WebhookVerifierService(makeConfig(), makeLock());
      const rawBody = Buffer.from('{"hello":"world"}');
      const signature =
        'sha256=' + crypto.createHmac('sha256', secrets.WEBHOOK_SIGNING_KEY).update(rawBody).digest('hex');

      await expect(
        service.validateRequest({ rawBody, parsedBody: { hello: 'world' }, signatureHeader: signature }),
      ).resolves.toBe(rawBody.toString('utf8'));
    });

    it('rejects a missing/empty body as malformed with 400, before touching signatures', async () => {
      const service = new WebhookVerifierService(makeConfig(), makeLock());

      await expect(
        service.validateRequest({ rawBody: undefined, parsedBody: undefined, signatureHeader: 'sha256=abcd' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.validateRequest({ rawBody: Buffer.alloc(0), signatureHeader: 'sha256=abcd' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid signature with 401', async () => {
      const service = new WebhookVerifierService(makeConfig(), makeLock());
      const rawBody = Buffer.from('{"a":1}');

      await expect(
        service.validateRequest({ rawBody, signatureHeader: 'sha256=' + 'ab'.repeat(32) }),
      ).rejects.toThrow(UnauthorizedException);
    });

    describe('timestamped signatures (replay window)', () => {
      const sign = (secret: string, timestamp: number, body: string) =>
        `t=${timestamp},v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

      it('accepts a freshly-timestamped signature', async () => {
        const service = new WebhookVerifierService(makeConfig(), makeLock());
        const rawBody = '{"event":"inquiry.approved"}';
        const signature = sign(secrets.WEBHOOK_SIGNING_KEY, Math.floor(Date.now() / 1000), rawBody);

        await expect(service.validateRequest({ rawBody, signatureHeader: signature })).resolves.toBe(rawBody);
      });

      it('rejects a signature whose timestamp is outside the tolerance window', async () => {
        const service = new WebhookVerifierService(makeConfig(), makeLock());
        const rawBody = '{"event":"inquiry.approved"}';
        const staleTimestamp = Math.floor(Date.now() / 1000) - 3600; // 1 hour old
        const signature = sign(secrets.WEBHOOK_SIGNING_KEY, staleTimestamp, rawBody);

        await expect(service.validateRequest({ rawBody, signatureHeader: signature })).rejects.toThrow(
          UnauthorizedException,
        );
      });

      it('honors a custom toleranceSeconds override', async () => {
        const service = new WebhookVerifierService(makeConfig(), makeLock());
        const rawBody = '{"event":"inquiry.approved"}';
        const timestamp = Math.floor(Date.now() / 1000) - 120; // 2 minutes old
        const signature = sign(secrets.WEBHOOK_SIGNING_KEY, timestamp, rawBody);

        await expect(
          service.validateRequest({ rawBody, signatureHeader: signature, toleranceSeconds: 60 }),
        ).rejects.toThrow(UnauthorizedException);

        await expect(
          service.validateRequest({ rawBody, signatureHeader: signature, toleranceSeconds: 300 }),
        ).resolves.toBe(rawBody);
      });
    });

    describe('replay protection', () => {
      it('rejects an exact-duplicate delivery on the second attempt', async () => {
        const lock = makeLock();
        const service = new WebhookVerifierService(makeConfig(), lock);
        const rawBody = '{"event":"charge.success"}';
        const signature =
          'sha256=' + crypto.createHmac('sha256', secrets.WEBHOOK_SIGNING_KEY).update(rawBody).digest('hex');

        await expect(service.validateRequest({ rawBody, signatureHeader: signature })).resolves.toBe(rawBody);
        await expect(service.validateRequest({ rawBody, signatureHeader: signature })).rejects.toThrow(
          ConflictException,
        );
      });

      it('does not consume the replay slot for a request that fails signature verification', async () => {
        const lock = makeLock();
        const service = new WebhookVerifierService(makeConfig(), lock);
        const rawBody = '{"event":"charge.success"}';
        const badSignature = 'sha256=' + 'ab'.repeat(32);

        await expect(service.validateRequest({ rawBody, signatureHeader: badSignature })).rejects.toThrow(
          UnauthorizedException,
        );
        expect(lock.acquire).not.toHaveBeenCalled();
      });

      it('can be disabled per-call via enableReplayProtection: false', async () => {
        const lock = makeLock();
        const service = new WebhookVerifierService(makeConfig(), lock);
        const rawBody = '{"event":"charge.success"}';
        const signature =
          'sha256=' + crypto.createHmac('sha256', secrets.WEBHOOK_SIGNING_KEY).update(rawBody).digest('hex');

        await service.validateRequest({ rawBody, signatureHeader: signature, enableReplayProtection: false });
        await expect(
          service.validateRequest({ rawBody, signatureHeader: signature, enableReplayProtection: false }),
        ).resolves.toBe(rawBody);
        expect(lock.acquire).not.toHaveBeenCalled();
      });

      it('fails open (logs and allows through) when the replay store is unreachable', async () => {
        const flakyLock = {
          acquire: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        } as unknown as DistributedLockService;
        const service = new WebhookVerifierService(makeConfig(), flakyLock);
        const rawBody = '{"event":"charge.success"}';
        const signature =
          'sha256=' + crypto.createHmac('sha256', secrets.WEBHOOK_SIGNING_KEY).update(rawBody).digest('hex');

        await expect(service.validateRequest({ rawBody, signatureHeader: signature })).resolves.toBe(rawBody);
      });
    });
  });
});
