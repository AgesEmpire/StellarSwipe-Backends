import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import {
  SorobanTransactionBuilderService,
  MarketOrderParams,
  LimitOrderParams,
} from './soroban-transaction-builder.service';
import { TradeSide } from '../trades/entities/trade.entity';

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, def: unknown) => {
    const cfg: Record<string, unknown> = {
      'stellar.tradeContractId': 'TEST_CONTRACT_ID',
      'trade.defaultSlippageBps': 50,
      'trade.maxSlippageBps': 500,
    };
    return cfg[key] ?? def;
  }),
};

const baseMarket: MarketOrderParams = {
  userId: 'user-001',
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  amount: 100,
  entryPrice: 0.15,
  side: TradeSide.BUY,
};

const baseLimit: LimitOrderParams = {
  userId: 'user-001',
  baseAsset: 'XLM',
  counterAsset: 'USDC',
  amount: 200,
  limitPrice: 0.14,
  side: TradeSide.BUY,
};

describe('SorobanTransactionBuilderService', () => {
  let service: SorobanTransactionBuilderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanTransactionBuilderService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(SorobanTransactionBuilderService);
  });

  // ── Market order ────────────────────────────────────────────────────────────

  describe('buildMarketOrder', () => {
    it('builds a valid market order payload', () => {
      const payload = service.buildMarketOrder(baseMarket);

      expect(payload.orderType).toBe('market');
      expect(payload.method).toBe('execute_market_order');
      expect(payload.contractId).toBe('TEST_CONTRACT_ID');
      expect(payload.adjustedAmount).toBe(100);
      expect(payload.slippageBps).toBe(50); // default
    });

    it('converts slippage percentage to basis points', () => {
      const payload = service.buildMarketOrder({ ...baseMarket, slippageTolerance: 1.0 });
      expect(payload.slippageBps).toBe(100);
    });

    it('caps slippage at maxSlippageBps', () => {
      const payload = service.buildMarketOrder({ ...baseMarket, slippageTolerance: 99 });
      expect(payload.slippageBps).toBeLessThanOrEqual(500);
    });

    it('applies maxExposure risk cap when notional exceeds limit', () => {
      // amount * price = 100 * 0.15 = 15; maxExposure = 1 → cap to ~6.67
      const payload = service.buildMarketOrder(baseMarket, { maxExposure: 1 });
      expect(payload.adjustedAmount).toBeLessThan(100);
    });

    it('does not cap amount when within exposure limit', () => {
      const payload = service.buildMarketOrder(baseMarket, { maxExposure: 1000 });
      expect(payload.adjustedAmount).toBe(100);
    });

    it('encodes XLM amount as stroops in args', () => {
      const payload = service.buildMarketOrder(baseMarket);
      const amountArg = payload.args.find((a) => a.type === 'i128');
      // 100 * 10_000_000 = 1_000_000_000
      expect(amountArg?.value).toBe('1000000000');
    });

    it('includes stopLoss and takeProfit in metadata', () => {
      const payload = service.buildMarketOrder({
        ...baseMarket,
        stopLossPrice: 0.12,
        takeProfitPrice: 0.20,
      });
      expect(payload.metadata.stopLossPrice).toBe(0.12);
      expect(payload.metadata.takeProfitPrice).toBe(0.20);
    });

    it('throws when amount is zero', () => {
      expect(() => service.buildMarketOrder({ ...baseMarket, amount: 0 })).toThrow(
        BadRequestException,
      );
    });

    it('throws when base and counter assets are the same', () => {
      expect(() =>
        service.buildMarketOrder({ ...baseMarket, counterAsset: 'XLM' }),
      ).toThrow(BadRequestException);
    });

    it('throws when baseAsset is empty', () => {
      expect(() =>
        service.buildMarketOrder({ ...baseMarket, baseAsset: '' }),
      ).toThrow(BadRequestException);
    });
  });

  // ── Limit order ─────────────────────────────────────────────────────────────

  describe('buildLimitOrder', () => {
    it('builds a valid limit order payload', () => {
      const payload = service.buildLimitOrder(baseLimit);

      expect(payload.orderType).toBe('limit');
      expect(payload.method).toBe('place_limit_order');
      expect(payload.slippageBps).toBe(0);
      expect(payload.adjustedAmount).toBe(200);
    });

    it('sets default expiry to 24 hours from now', () => {
      const before = Math.floor(Date.now() / 1000) + 86_400 - 5;
      const payload = service.buildLimitOrder(baseLimit);
      const after = Math.floor(Date.now() / 1000) + 86_400 + 5;

      expect(payload.metadata.expiresAt).toBeGreaterThanOrEqual(before);
      expect(payload.metadata.expiresAt).toBeLessThanOrEqual(after);
    });

    it('respects caller-provided expiresAt', () => {
      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const payload = service.buildLimitOrder({ ...baseLimit, expiresAt: expiry });
      expect(payload.metadata.expiresAt).toBe(expiry);
    });

    it('stores limitPrice in metadata', () => {
      const payload = service.buildLimitOrder(baseLimit);
      expect(payload.metadata.limitPrice).toBe(0.14);
    });

    it('throws when limitPrice is zero', () => {
      expect(() =>
        service.buildLimitOrder({ ...baseLimit, limitPrice: 0 }),
      ).toThrow(BadRequestException);
    });

    it('applies risk cap for limit orders', () => {
      // notional = 200 * 0.14 = 28; maxExposure = 1 → capped
      const payload = service.buildLimitOrder(baseLimit, { maxExposure: 1 });
      expect(payload.adjustedAmount).toBeLessThan(200);
    });
  });

  // ── validatePayload ──────────────────────────────────────────────────────────

  describe('validatePayload', () => {
    it('throws when contractId is missing', () => {
      const payload = service.buildMarketOrder(baseMarket);
      (payload as any).contractId = '';
      expect(() => service.validatePayload(payload)).toThrow(BadRequestException);
    });

    it('throws when method is missing', () => {
      const payload = service.buildMarketOrder(baseMarket);
      (payload as any).method = '';
      expect(() => service.validatePayload(payload)).toThrow(BadRequestException);
    });

    it('throws when args is empty', () => {
      const payload = service.buildMarketOrder(baseMarket);
      (payload as any).args = [];
      expect(() => service.validatePayload(payload)).toThrow(BadRequestException);
    });

    it('throws when adjustedAmount is zero', () => {
      const payload = service.buildMarketOrder(baseMarket);
      (payload as any).adjustedAmount = 0;
      expect(() => service.validatePayload(payload)).toThrow(BadRequestException);
    });

    it('does not throw for a valid payload', () => {
      const payload = service.buildMarketOrder(baseMarket);
      expect(() => service.validatePayload(payload)).not.toThrow();
    });
  });
});
