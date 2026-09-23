import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PersonaProvider } from './persona.provider';

describe('PersonaProvider.verifyWebhookSignature', () => {
  const sign = (secret: string, timestamp: number, body: string) =>
    `t=${timestamp},v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

  const makeProvider = (webhookSecret: string) => {
    const values: Record<string, string> = {
      PERSONA_API_KEY: 'api-key',
      PERSONA_TEMPLATE_ID: 'template-id',
      PERSONA_WEBHOOK_SECRET: webhookSecret,
    };
    const config = {
      getOrThrow: jest.fn((key: string) => values[key]),
      get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
    } as unknown as ConfigService;
    return new PersonaProvider(config);
  };

  it('accepts a signature produced with the current secret', () => {
    const provider = makeProvider('current-secret');
    const body = '{"data":{"attributes":{"name":"inquiry.approved"}}}';
    const signature = sign('current-secret', Math.floor(Date.now() / 1000), body);

    expect(provider.verifyWebhookSignature(body, signature)).toBe(true);
  });

  it('accepts a signature produced with a rotated-out (previous) secret when configured', () => {
    const provider = makeProvider('new-secret,old-secret');
    const body = '{"data":{"attributes":{"name":"inquiry.approved"}}}';
    const signature = sign('old-secret', Math.floor(Date.now() / 1000), body);

    expect(provider.verifyWebhookSignature(body, signature)).toBe(true);
  });

  it('rejects a signature produced with an unconfigured secret', () => {
    const provider = makeProvider('current-secret');
    const body = '{"data":{}}';
    const signature = sign('wrong-secret', Math.floor(Date.now() / 1000), body);

    expect(provider.verifyWebhookSignature(body, signature)).toBe(false);
  });

  it('rejects a stale timestamp beyond the tolerance window', () => {
    const provider = makeProvider('current-secret');
    const body = '{"data":{}}';
    const staleTimestamp = Math.floor(Date.now() / 1000) - 3600;
    const signature = sign('current-secret', staleTimestamp, body);

    expect(provider.verifyWebhookSignature(body, signature)).toBe(false);
  });

  it('rejects a timestamp implausibly far in the future', () => {
    const provider = makeProvider('current-secret');
    const body = '{"data":{}}';
    const futureTimestamp = Math.floor(Date.now() / 1000) + 3600;
    const signature = sign('current-secret', futureTimestamp, body);

    expect(provider.verifyWebhookSignature(body, signature)).toBe(false);
  });

  it('rejects a malformed signature header', () => {
    const provider = makeProvider('current-secret');
    expect(provider.verifyWebhookSignature('{}', 'not-a-valid-header')).toBe(false);
  });
});
