import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { CanaryTradeService } from '../src/monitoring/canary-trade.service';

describe('CanaryTradeService', () => {
  let service: CanaryTradeService;
  let eventEmitter: { emit: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    eventEmitter = { emit: jest.fn() };
    configService = {
      get: jest.fn((key: string) => {
        const config: Record<string, string> = {
          SOROBAN_TESTNET_RPC_URL: 'https://soroban-testnet.stellar.org',
          CANARY_CONTRACT_ID: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanaryTradeService,
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(CanaryTradeService);
  });

  describe('runCanary', () => {
    it('returns success for a valid simulated trade', async () => {
      const result = await service.runCanary();

      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.events).toContain('trade_executed');
      expect(result.actualState.tradeExecuted).toBe(true);
      expect(result.errorMessage).toBeUndefined();
    });

    it('returns failure when config is missing', async () => {
      configService.get.mockReturnValue(undefined);

      const result = await service.runCanary();

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Missing');
    });
  });

  describe('assertExpectedOutcome', () => {
    const expected = {
      tradeExecuted: true,
      amountFilled: '0.0001',
      baseAsset: 'XLM',
      counterAsset: 'USDC',
    };

    it('returns true when state and events match', () => {
      const tradeResult = {
        state: { tradeExecuted: true, baseAsset: 'XLM', counterAsset: 'USDC' },
        events: ['trade_executed'],
      };
      expect(service.assertExpectedOutcome(expected, tradeResult)).toBe(true);
    });

    it('returns false when trade was not executed', () => {
      const tradeResult = {
        state: { tradeExecuted: false, baseAsset: 'XLM', counterAsset: 'USDC' },
        events: ['trade_executed'],
      };
      expect(service.assertExpectedOutcome(expected, tradeResult)).toBe(false);
    });

    it('returns false when no events emitted', () => {
      const tradeResult = {
        state: { tradeExecuted: true, baseAsset: 'XLM', counterAsset: 'USDC' },
        events: [],
      };
      expect(service.assertExpectedOutcome(expected, tradeResult)).toBe(false);
    });

    it('returns false when asset mismatch', () => {
      const tradeResult = {
        state: { tradeExecuted: true, baseAsset: 'ETH', counterAsset: 'USDC' },
        events: ['trade_executed'],
      };
      expect(service.assertExpectedOutcome(expected, tradeResult)).toBe(false);
    });
  });

  describe('executeCanaryTrade', () => {
    it('emits alert on failure', async () => {
      configService.get.mockReturnValue(undefined);

      await service.executeCanaryTrade();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'alert.canary.failure',
        expect.objectContaining({
          type: 'CANARY_TRADE_FAILURE',
          severity: 'high',
        }),
      );
    });

    it('does not emit alert on success', async () => {
      await service.executeCanaryTrade();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
