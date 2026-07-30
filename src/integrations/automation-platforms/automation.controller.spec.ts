import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookVerifierService } from '../webhooks/webhook-verifier.service';
import { AutomationController } from './automation.controller';
import { ActionType } from './dto/action-config.dto';
import { TriggerEvent } from './dto/trigger-config.dto';

describe('AutomationController webhook signatures', () => {
  const secret = 'automation-webhook-secret-at-least-32-chars';
  const zapier = { subscribe: jest.fn(), unsubscribe: jest.fn(), dispatch: jest.fn() };
  const make = { subscribe: jest.fn(), unsubscribe: jest.fn(), dispatch: jest.fn() };
  const signals = { create: jest.fn() };
  const trades = { executeTrade: jest.fn() };
  const portfolio = { getPerformance: jest.fn() };

  let controller: AutomationController;

  beforeEach(() => {
    const verifier = new WebhookVerifierService({
      get: jest.fn((key: string) => (key === 'WEBHOOK_SIGNING_KEY' ? secret : undefined)),
    } as unknown as ConfigService);

    controller = new AutomationController(
      zapier as any,
      make as any,
      signals as any,
      trades as any,
      portfolio as any,
      verifier,
    );

    jest.clearAllMocks();
  });

  it('rejects unsigned inbound action webhooks before executing actions', async () => {
    await expect(
      controller.handleAction(
        { action: ActionType.GET_PORTFOLIO, userId: 'user-1' },
        undefined as any,
        { rawBody: Buffer.from('{}') } as any,
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(portfolio.getPerformance).not.toHaveBeenCalled();
  });

  it('accepts signed trigger dispatch webhooks', async () => {
    const rawBody = Buffer.from(
      '{"userId":"user-1","event":"trade_executed","data":{},"timestamp":"2026-07-29T00:00:00.000Z"}',
    );
    const signature =
      'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    await expect(
      controller.dispatchTrigger(
        {
          userId: 'user-1',
          event: TriggerEvent.TRADE_EXECUTED,
          data: {},
          timestamp: '2026-07-29T00:00:00.000Z',
        },
        signature,
        { rawBody } as any,
      ),
    ).resolves.toEqual({ dispatched: true });

    expect(zapier.dispatch).toHaveBeenCalledWith(
      'user-1',
      TriggerEvent.TRADE_EXECUTED,
      {},
    );
    expect(make.dispatch).toHaveBeenCalledWith(
      'user-1',
      TriggerEvent.TRADE_EXECUTED,
      {},
    );
  });
});
