import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { OnfidoProvider } from './onfido.provider';

describe('OnfidoProvider.verifyWebhookSignature', () => {
  const sign = (secret: string, body: string) => crypto.createHmac('sha256', secret).update(body).digest('hex');

  const makeProvider = (webhookToken: string) => {
    const values: Record<string, string> = {
      ONFIDO_API_TOKEN: 'api-token',
      ONFIDO_WORKFLOW_ID: 'workflow-id',
      ONFIDO_WEBHOOK_TOKEN: webhookToken,
    };
    const config = {
      getOrThrow: jest.fn((key: string) => values[key]),
      get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
    } as unknown as ConfigService;
    return new OnfidoProvider(config);
  };

  it('accepts a signature produced with the current token', () => {
    const provider = makeProvider('current-token');
    const body = '{"resource_type":"workflow_run"}';
    expect(provider.verifyWebhookSignature(body, sign('current-token', body))).toBe(true);
  });

  it('accepts a signature produced with a rotated-out (previous) token when configured', () => {
    const provider = makeProvider('new-token,old-token');
    const body = '{"resource_type":"workflow_run"}';
    expect(provider.verifyWebhookSignature(body, sign('old-token', body))).toBe(true);
  });

  it('rejects a signature produced with an unconfigured token', () => {
    const provider = makeProvider('current-token');
    const body = '{"resource_type":"workflow_run"}';
    expect(provider.verifyWebhookSignature(body, sign('wrong-token', body))).toBe(false);
  });

  it('rejects a malformed signature header', () => {
    const provider = makeProvider('current-token');
    expect(provider.verifyWebhookSignature('{}', '')).toBe(false);
  });
});
