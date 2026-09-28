jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

import { BadRequestException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { WebhooksService } from './webhooks.service';
import { Webhook } from './entities/webhook.entity';
import { WEBHOOK_VERIFICATION_TOKEN_TTL_MS } from './jobs/webhook-delivery.constants';

jest.mock('./pipes/ssrf-validation.pipe', () => ({
  SsrfValidationPipe: jest.fn().mockImplementation(() => ({
    transform: jest.fn().mockResolvedValue(undefined),
  })),
}));

type Row = Webhook & Record<string, unknown>;

/** Minimal stateful stand-in for the webhook repository. */
function createWebhookStore() {
  const rows = new Map<string, Row>();
  const matches = (row: Row, criteria: Record<string, unknown>) =>
    Object.entries(criteria).every(([key, expected]) =>
      expected instanceof FindOperator
        ? (row[key] as Date) > (expected.value as Date)
        : row[key] === expected,
    );

  return {
    rows,
    create: jest.fn((data: Partial<Webhook>) => ({ ...data }) as Webhook),
    save: jest.fn(async (webhook: Webhook) => {
      const id = webhook.id ?? `wh-${rows.size + 1}`;
      const { verificationTokenHash: _omit, ...fields } = webhook as Row;
      rows.set(id, { ...rows.get(id), ...fields, id } as Row);
      return { ...webhook, id };
    }),
    // verificationTokenHash is select: false, so reads never expose it.
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
      const row = rows.get(where.id);
      if (!row) return null;
      const { verificationTokenHash: _hidden, ...visible } = row;
      return { ...visible } as Webhook;
    }),
    update: jest.fn(
      async (
        criteria: string | Record<string, unknown>,
        patch: Partial<Row>,
      ) => {
        const where =
          typeof criteria === 'string' ? { id: criteria } : criteria;
        const row = rows.get(where.id as string);
        if (!row || !matches(row, where)) return { affected: 0 };
        Object.assign(row, patch);
        return { affected: 1 };
      },
    ),
  };
}

describe('Webhook endpoint verification', () => {
  const userId = 'user-1';
  let store: ReturnType<typeof createWebhookStore>;
  let sender: { sendVerificationChallenge: jest.Mock };
  let service: WebhooksService;

  const lastToken = (): string => {
    const { calls } = sender.sendVerificationChallenge.mock;
    return calls[calls.length - 1][2].token;
  };

  const registerWebhook = () =>
    service.register(userId, {
      url: 'https://hooks.example.com/a',
      events: ['trade.executed'],
    } as any);

  beforeEach(() => {
    store = createWebhookStore();
    sender = { sendVerificationChallenge: jest.fn().mockResolvedValue(true) };
    service = new WebhooksService(
      store as any,
      {} as any,
      { generateSecret: () => 'a'.repeat(64) } as any,
      sender as any,
    );
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => {});
  });

  afterEach(() => jest.useRealTimers());

  it('keeps a new endpoint inactive until it is verified', async () => {
    const webhook = await registerWebhook();

    expect(webhook.active).toBe(false);
    expect(webhook.pendingUrl).toBe('https://hooks.example.com/a');
    expect(sender.sendVerificationChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ id: webhook.id }),
      'https://hooks.example.com/a',
      expect.objectContaining({
        event: 'webhook.verification',
        webhookId: webhook.id,
        token: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(store.rows.get(webhook.id)?.verificationTokenHash).not.toBe(
      lastToken(),
    );

    const verified = await service.verifyEndpoint(
      userId,
      webhook.id,
      lastToken(),
    );

    expect(verified.active).toBe(true);
    expect(verified.url).toBe('https://hooks.example.com/a');
    expect(verified.pendingUrl).toBeNull();
    expect(verified.urlVerifiedAt).toBeInstanceOf(Date);
  });

  it('rejects activating an unverified endpoint', async () => {
    const webhook = await registerWebhook();

    await expect(
      service.update(userId, webhook.id, { active: true } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a replayed verification token', async () => {
    const webhook = await registerWebhook();
    const token = lastToken();

    await service.verifyEndpoint(userId, webhook.id, token);

    await expect(
      service.verifyEndpoint(userId, webhook.id, token),
    ).rejects.toThrow('No endpoint verification is pending');
  });

  it('rejects an incorrect token', async () => {
    const webhook = await registerWebhook();

    await expect(
      service.verifyEndpoint(userId, webhook.id, 'f'.repeat(64)),
    ).rejects.toThrow('Invalid verification token');
    expect(store.rows.get(webhook.id)?.active).toBe(false);
  });

  it('rejects an expired token', async () => {
    const webhook = await registerWebhook();
    const token = lastToken();
    jest
      .useFakeTimers()
      .setSystemTime(Date.now() + WEBHOOK_VERIFICATION_TOKEN_TTL_MS + 1);

    await expect(
      service.verifyEndpoint(userId, webhook.id, token),
    ).rejects.toThrow('Verification token has expired');
  });

  it('scopes tokens to a single webhook', async () => {
    const first = await registerWebhook();
    const firstToken = lastToken();
    const second = await registerWebhook();

    await expect(
      service.verifyEndpoint(userId, second.id, firstToken),
    ).rejects.toThrow('Invalid verification token');
    await expect(
      service.verifyEndpoint(userId, first.id, firstToken),
    ).resolves.toEqual(expect.objectContaining({ active: true }));
  });

  it('keeps delivering to the current URL until a changed URL is verified', async () => {
    const webhook = await registerWebhook();
    await service.verifyEndpoint(userId, webhook.id, lastToken());

    const updated = await service.update(userId, webhook.id, {
      url: 'https://hooks.example.com/b',
    } as any);

    expect(updated.url).toBe('https://hooks.example.com/a');
    expect(updated.pendingUrl).toBe('https://hooks.example.com/b');
    expect(updated.active).toBe(true);

    await service.verifyEndpoint(userId, webhook.id, lastToken());
    expect(store.rows.get(webhook.id)?.url).toBe('https://hooks.example.com/b');
  });

  it('invalidates the previous token when the URL changes again', async () => {
    const webhook = await registerWebhook();
    await service.verifyEndpoint(userId, webhook.id, lastToken());

    await service.update(userId, webhook.id, {
      url: 'https://hooks.example.com/b',
    } as any);
    const staleToken = lastToken();
    await service.update(userId, webhook.id, {
      url: 'https://hooks.example.com/c',
    } as any);

    await expect(
      service.verifyEndpoint(userId, webhook.id, staleToken),
    ).rejects.toThrow('Invalid verification token');
  });

  it('issues a fresh token on resend', async () => {
    const webhook = await registerWebhook();
    const original = lastToken();

    await service.resendEndpointVerification(userId, webhook.id);

    expect(lastToken()).not.toBe(original);
    await expect(
      service.verifyEndpoint(userId, webhook.id, original),
    ).rejects.toThrow('Invalid verification token');
  });
});
