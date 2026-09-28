jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { Logger } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { Webhook } from './entities/webhook.entity';

describe('WebhooksController secret masking', () => {
  const secret =
    'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9a';
  const nextSecret =
    'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';
  const req = { user: { id: 'user-1' } };

  let service: jest.Mocked<WebhooksService>;
  let controller: WebhooksController;
  let logSpies: jest.SpyInstance[];

  const webhook = (overrides: Partial<Webhook> = {}): Webhook =>
    ({
      id: 'wh-1',
      userId: 'user-1',
      url: 'https://example.com/hook',
      events: ['trade.executed'],
      secret,
      active: true,
      ...overrides,
    }) as Webhook;

  const expectNoRawSecrets = (value: unknown) => {
    const serialized = JSON.stringify(value);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(nextSecret);
  };

  beforeEach(() => {
    service = {
      register: jest.fn(),
      findAllForUser: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      initiateSecretRotation: jest.fn(),
      finalizeSecretRotation: jest.fn(),
    } as unknown as jest.Mocked<WebhooksService>;
    controller = new WebhooksController(service);
    logSpies = (['log', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
  });

  afterEach(() => {
    logSpies.forEach((spy) => {
      expectNoRawSecrets(spy.mock.calls);
      spy.mockRestore();
    });
  });

  it('returns the full secret only on creation', async () => {
    service.register.mockResolvedValue(webhook());

    const result = await controller.register(req, {
      url: 'https://example.com/hook',
      events: ['trade.executed'],
    });

    expect(result.secret).toBe(secret);
  });

  it('masks secrets when listing webhooks', async () => {
    service.findAllForUser.mockResolvedValue([
      webhook(),
      webhook({ id: 'wh-2', nextSecret }),
    ]);

    const result = await controller.findAll(req);

    expectNoRawSecrets(result);
    expect(result[0].secret).toBe(`****${secret.slice(-4)}`);
    expect(result[1].nextSecret).toBe(`****${nextSecret.slice(-4)}`);
  });

  it('masks secrets on read and update', async () => {
    service.findOne.mockResolvedValue(webhook({ nextSecret }));
    service.update.mockResolvedValue(webhook({ nextSecret }));

    expectNoRawSecrets(await controller.findOne(req, 'wh-1'));
    expectNoRawSecrets(
      await controller.update(req, 'wh-1', { description: 'updated' }),
    );
  });

  it('reveals only the new secret when a rotation is initiated', async () => {
    service.initiateSecretRotation.mockResolvedValue(webhook({ nextSecret }));

    const result = await controller.initiateSecretRotation(req, 'wh-1', 1000);

    expect(result.nextSecret).toBe(nextSecret);
    expect(result.secret).not.toContain(secret);
  });

  it('masks the promoted secret once a rotation is finalized', async () => {
    service.finalizeSecretRotation.mockResolvedValue(
      webhook({ secret: nextSecret, nextSecret: undefined }),
    );

    const result = await controller.finalizeSecretRotation(req, 'wh-1');

    expectNoRawSecrets(result);
    expect(result.nextSecret).toBeUndefined();
  });
});
