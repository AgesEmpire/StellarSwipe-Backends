import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { WebhookController } from './webhook.controller';
import { WebhookVerifierService } from './webhook-verifier.service';
import { createWebhookSignature } from './utils/signature-validator';

describe('WebhookVerifierService', () => {
  const payload = Buffer.from(
    JSON.stringify({ event: 'trade.executed', id: 'evt_123' }),
  );
  const signingKey = 'provider-signing-secret';
  let service: WebhookVerifierService;
  let controller: WebhookController;

  beforeEach(() => {
    const configService = {
      get: jest.fn((key: string) => {
        if (key === 'webhooks.signingKeys.stellar') return signingKey;
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new WebhookVerifierService(configService);
    controller = new WebhookController(service);
  });

  it('accepts valid provider signatures from configured signing keys', () => {
    const signature = createWebhookSignature(payload, signingKey);

    expect(service.verifySignature('stellar', payload, signature)).toBe(true);
    expect(
      service.verifySignature('stellar', payload, `sha256=${signature}`),
    ).toBe(true);
  });

  it('rejects invalid and missing signatures', () => {
    expect(service.verifySignature('stellar', payload, 'bad-signature')).toBe(
      false,
    );
    expect(service.verifySignature('stellar', payload, undefined)).toBe(false);

    expect(() =>
      service.assertValidSignature('stellar', payload, 'bad-signature'),
    ).toThrow(UnauthorizedException);
  });

  it('rejects signatures when no provider signing key is configured', () => {
    const signature = createWebhookSignature(payload, signingKey);

    expect(service.verifySignature('unknown', payload, signature)).toBe(false);
  });

  it('returns 401 through the controller for invalid incoming webhook requests', async () => {
    await expect(
      controller.receiveWebhook(
        'stellar',
        { 'x-webhook-signature': 'bad-signature' },
        { rawBody: payload } as never,
        { event: 'trade.executed', id: 'evt_123' },
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('accepts valid incoming webhook requests through the controller', async () => {
    const signature = createWebhookSignature(payload, signingKey);

    await expect(
      controller.receiveWebhook(
        'stellar',
        { 'x-webhook-signature': signature },
        { rawBody: payload } as never,
        { event: 'trade.executed', id: 'evt_123' },
      ),
    ).resolves.toEqual({
      received: true,
      provider: 'stellar',
    });
  });
});
