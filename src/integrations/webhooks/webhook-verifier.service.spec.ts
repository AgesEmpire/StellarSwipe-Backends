import { ConfigService } from '@nestjs/config';
import { WebhookVerifierService } from './webhook-verifier.service';
import * as crypto from 'crypto';

describe('WebhookVerifierService', () => {
  let service: WebhookVerifierService;
  const secret = 'test-secret';
  beforeEach(() => {
    const config = { get: (k: string) => secret } as unknown as ConfigService;
    service = new WebhookVerifierService(config);
  });

  it('validates correct signature', () => {
    const body = JSON.stringify({ hello: 'world' });
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(service.validate(body, sig)).toBe(true);
  });

  it('rejects incorrect signature', () => {
    const body = 'x';
    const sig = 'sha256=' + crypto.createHmac('sha256', 'other').update(body).digest('hex');
    try {
      service.validate(body, sig);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.status).toBe(401);
    }
  });
});
