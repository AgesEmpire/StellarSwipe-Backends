import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookVerifierService } from './webhook-verifier.service';

describe('WebhookVerifierService', () => {
  const secrets: Record<string, string> = {
    WEBHOOK_SIGNING_KEY: 'generic-webhook-secret-at-least-32-chars',
    PAYSTACK_SECRET_KEY: 'paystack-secret-at-least-32-chars',
  };

  let service: WebhookVerifierService;

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string) => secrets[key]),
    } as unknown as ConfigService;
    service = new WebhookVerifierService(config);
  });

  it('validates a correct sha256 signature', () => {
    const body = JSON.stringify({ hello: 'world' });
    const signature =
      'sha256=' +
      crypto
        .createHmac('sha256', secrets.WEBHOOK_SIGNING_KEY)
        .update(body)
        .digest('hex');

    expect(service.validate(body, signature)).toBe(true);
  });

  it('validates provider-specific sha512 signatures', () => {
    const body = JSON.stringify({ event: 'charge.success' });
    const signature = crypto
      .createHmac('sha512', secrets.PAYSTACK_SECRET_KEY)
      .update(body)
      .digest('hex');

    expect(service.validate(body, signature, 'PAYSTACK_SECRET_KEY', 'sha512')).toBe(true);
  });

  it('rejects missing and malformed signatures with 401', () => {
    expect(() => service.validate('{"ok":true}', undefined)).toThrow(
      UnauthorizedException,
    );
    expect(() => service.validate('{"ok":true}', 'sha256=not-hex')).toThrow(
      UnauthorizedException,
    );
  });

  it('uses the raw request body before falling back to serialized parsed body', () => {
    const rawBody = Buffer.from('{"hello":"world"}');
    const signature =
      'sha256=' +
      crypto
        .createHmac('sha256', secrets.WEBHOOK_SIGNING_KEY)
        .update(rawBody)
        .digest('hex');

    expect(
      service.validateRequest({
        rawBody,
        parsedBody: { hello: 'world' },
        signatureHeader: signature,
      }),
    ).toBe(rawBody.toString('utf8'));
  });
});
