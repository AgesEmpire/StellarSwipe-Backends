import { Test, TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
import { RiskGateService } from './risk-gate.service';
import { RISK_CODES } from './risk-gate.config';

const baseCtx = {
  userId: 'user-1',
  pair: 'XLM/USDC',
  tradeSizeUSD: 100,
  availableBalanceUSD: 5000,
};

describe('RiskGateService', () => {
  let service: RiskGateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RiskGateService],
    }).compile();

    service = module.get<RiskGateService>(RiskGateService);

    delete process.env.RISK_MAX_TRADE_USD;
    delete process.env.RISK_MIN_BALANCE_USD;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('passes when balance and size are within limits', async () => {
    await expect(service.evaluate(baseCtx)).resolves.toBeUndefined();
  });

  describe('RISK_001 — insufficient balance', () => {
    it('blocks when post-trade balance would fall below minimum buffer', async () => {
      process.env.RISK_MIN_BALANCE_USD = '50';
      const ctx = { ...baseCtx, availableBalanceUSD: 120, tradeSizeUSD: 100 };
      // After trade: $20 remaining < $50 buffer
      await expect(service.evaluate(ctx)).rejects.toThrow(UnprocessableEntityException);
    });

    it('attaches RISK_001 code to the error', async () => {
      const ctx = { ...baseCtx, availableBalanceUSD: 5, tradeSizeUSD: 100 };
      try {
        await service.evaluate(ctx);
        fail('expected error');
      } catch (err: any) {
        expect(err.code).toBe(RISK_CODES.INSUFFICIENT_BALANCE);
      }
    });
  });

  describe('RISK_002 — trade size exceeded', () => {
    it('blocks when trade size exceeds the configured maximum', async () => {
      process.env.RISK_MAX_TRADE_USD = '500';
      await expect(service.evaluate({ ...baseCtx, tradeSizeUSD: 501 })).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('attaches RISK_002 code to the error', async () => {
      process.env.RISK_MAX_TRADE_USD = '100';
      try {
        await service.evaluate({ ...baseCtx, tradeSizeUSD: 101 });
        fail('expected error');
      } catch (err: any) {
        expect(err.code).toBe(RISK_CODES.TRADE_SIZE_EXCEEDED);
      }
    });
  });

  it('evaluates RISK_001 before RISK_002 (balance check runs first)', async () => {
    process.env.RISK_MAX_TRADE_USD = '100';
    process.env.RISK_MIN_BALANCE_USD = '10';
    // Trade size fine (50 < 100) but balance too low
    const ctx = { ...baseCtx, tradeSizeUSD: 50, availableBalanceUSD: 55 };
    // 55 - 50 = 5 < 10 buffer → RISK_001
    try {
      await service.evaluate(ctx);
      fail('expected error');
    } catch (err: any) {
      expect(err.code).toBe(RISK_CODES.INSUFFICIENT_BALANCE);
    }
  });

  // ── boundary condition tests (kill boundary-flip mutants) ─────────────────

  describe('RISK_001 — exact boundary', () => {
    it('passes when post-trade balance equals the minimum buffer exactly', async () => {
      process.env.RISK_MIN_BALANCE_USD = '10';
      // 110 - 100 = 10 = buffer → should PASS (not strictly less than)
      const ctx = { ...baseCtx, availableBalanceUSD: 110, tradeSizeUSD: 100 };
      await expect(service.evaluate(ctx)).resolves.toBeUndefined();
      delete process.env.RISK_MIN_BALANCE_USD;
    });

    it('blocks when post-trade balance is 1 cent below the minimum buffer', async () => {
      process.env.RISK_MIN_BALANCE_USD = '10';
      // 109.99 - 100 = 9.99 < 10 → BLOCK
      const ctx = { ...baseCtx, availableBalanceUSD: 109.99, tradeSizeUSD: 100 };
      await expect(service.evaluate(ctx)).rejects.toThrow(UnprocessableEntityException);
      delete process.env.RISK_MIN_BALANCE_USD;
    });
  });

  describe('RISK_002 — exact boundary', () => {
    it('passes when trade size equals the maximum exactly', async () => {
      process.env.RISK_MAX_TRADE_USD = '500';
      // tradeSizeUSD === maxTradeSizeUSD → should PASS (not strictly greater than)
      await expect(
        service.evaluate({ ...baseCtx, tradeSizeUSD: 500 }),
      ).resolves.toBeUndefined();
      delete process.env.RISK_MAX_TRADE_USD;
    });

    it('blocks when trade size is 1 cent above the maximum', async () => {
      process.env.RISK_MAX_TRADE_USD = '500';
      await expect(
        service.evaluate({ ...baseCtx, tradeSizeUSD: 500.01 }),
      ).rejects.toThrow(UnprocessableEntityException);
      delete process.env.RISK_MAX_TRADE_USD;
    });
  });

  it('passes when available balance is large and trade size is tiny', async () => {
    const ctx = { ...baseCtx, availableBalanceUSD: 100_000, tradeSizeUSD: 1 };
    await expect(service.evaluate(ctx)).resolves.toBeUndefined();
  });
});
