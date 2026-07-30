import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookVerifierService } from '../../integrations/webhooks/webhook-verifier.service';
import { LocalPaymentController } from './local-payment.controller';

describe('LocalPaymentController webhook signatures', () => {
  const secrets: Record<string, string> = {
    MPESA_WEBHOOK_SECRET: 'mpesa-webhook-secret',
    PAYSTACK_SECRET_KEY: 'paystack-secret-at-least-32-chars',
  };

  const localPaymentService = {
    listAllProviders: jest.fn(),
    getAvailableProviders: jest.fn(),
    initiatePayment: jest.fn(),
    getPaymentStatus: jest.fn(),
    getUserPayments: jest.fn(),
  };
  const mpesaWebhook = { handle: jest.fn() };
  const paystackWebhook = { handle: jest.fn() };

  let controller: LocalPaymentController;

  beforeEach(() => {
    const verifier = new WebhookVerifierService({
      get: jest.fn((key: string) => secrets[key]),
    } as unknown as ConfigService);

    controller = new LocalPaymentController(
      localPaymentService as any,
      mpesaWebhook as any,
      paystackWebhook as any,
      verifier,
    );

    jest.clearAllMocks();
  });

  it('rejects unsigned M-Pesa webhooks before processing', async () => {
    await expect(
      controller.mpesaWebhook({ Body: {} }, undefined as any, {
        rawBody: Buffer.from('{}'),
      } as any),
    ).rejects.toThrow(UnauthorizedException);

    expect(mpesaWebhook.handle).not.toHaveBeenCalled();
  });

  it('accepts signed M-Pesa webhooks and preserves the signature for the handler', async () => {
    const rawBody = Buffer.from('{"Body":{"stkCallback":{"ResultCode":0}}}');
    const signature =
      'sha256=' +
      crypto.createHmac('sha256', secrets.MPESA_WEBHOOK_SECRET).update(rawBody).digest('hex');
    const payload = { Body: { stkCallback: { ResultCode: 0 } } };

    await expect(
      controller.mpesaWebhook(payload, signature, { rawBody } as any),
    ).resolves.toEqual({ received: true });

    expect(mpesaWebhook.handle).toHaveBeenCalledWith(payload, signature);
  });

  it('rejects Paystack webhooks signed with the wrong secret', async () => {
    const rawBody = Buffer.from('{"event":"charge.success"}');
    const badSignature = crypto
      .createHmac('sha512', 'wrong-secret')
      .update(rawBody)
      .digest('hex');

    await expect(
      controller.paystackWebhook(
        { event: 'charge.success' },
        badSignature,
        { rawBody } as any,
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(paystackWebhook.handle).not.toHaveBeenCalled();
  });
});
