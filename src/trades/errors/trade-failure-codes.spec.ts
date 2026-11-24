import { BadRequestException } from '@nestjs/common';
import {
  TRADE_FAILURE_CATALOG,
  TradeExecutionFailedException,
  TradeFailureCode,
  classifyTradeFailure,
  getTradeFailure,
  isTradeFailureCode,
} from './trade-failure-codes';

describe('Trade failure reason codes (#1527)', () => {
  it('documents every code in the catalog with a safe message', () => {
    for (const code of Object.values(TradeFailureCode)) {
      const def = TRADE_FAILURE_CATALOG[code];
      expect(def).toBeDefined();
      expect(def.code).toBe(code);
      expect(def.message.length).toBeGreaterThan(0);
    }
  });

  it('keeps code values stable (public contract)', () => {
    expect(TradeFailureCode.INSUFFICIENT_LIQUIDITY).toBe('TRADE_INSUFFICIENT_LIQUIDITY');
    expect(TradeFailureCode.TIMEOUT).toBe('TRADE_TIMEOUT');
    expect(TradeFailureCode.PROVIDER_REJECTED).toBe('TRADE_PROVIDER_REJECTED');
  });

  describe('classifyTradeFailure', () => {
    it.each([
      // validation
      ['Amount must be positive', TradeFailureCode.VALIDATION_FAILED],
      ['invalid asset code', TradeFailureCode.VALIDATION_FAILED],
      // liquidity
      ['op_too_few_offers', TradeFailureCode.INSUFFICIENT_LIQUIDITY],
      ['Insufficient liquidity on SDEX', TradeFailureCode.INSUFFICIENT_LIQUIDITY],
      ['op_under_dest_min', TradeFailureCode.INSUFFICIENT_LIQUIDITY],
      // balance
      ['op_underfunded', TradeFailureCode.INSUFFICIENT_BALANCE],
      // provider
      ['tx_failed: op_no_trust', TradeFailureCode.PROVIDER_REJECTED],
      ['Horizon returned 503', TradeFailureCode.PROVIDER_UNAVAILABLE],
      ['connect ECONNREFUSED 10.0.0.1:8000', TradeFailureCode.PROVIDER_UNAVAILABLE],
      // timeout
      ['Request timed out after 30000ms', TradeFailureCode.TIMEOUT],
      ['tx_too_late', TradeFailureCode.TIMEOUT],
      // others
      ['Slippage tolerance exceeded', TradeFailureCode.SLIPPAGE_EXCEEDED],
      ['Velocity limit reached', TradeFailureCode.RISK_LIMIT_EXCEEDED],
      ['Blocked by compliance rule R-12', TradeFailureCode.COMPLIANCE_BLOCKED],
      ['something odd happened', TradeFailureCode.UNKNOWN],
    ])('maps %p to %s', (raw, expected) => {
      expect(classifyTradeFailure(raw)).toBe(expected);
    });

    it('classifies Error instances including their code', () => {
      const err = Object.assign(new Error('socket hang up'), { code: 'ETIMEDOUT' });
      expect(classifyTradeFailure(err)).toBe(TradeFailureCode.TIMEOUT);
    });

    it('classifies structured provider payloads', () => {
      const payload = {
        extras: { result_codes: { transaction: 'tx_failed', operations: ['op_too_few_offers'] } },
      };
      expect(classifyTradeFailure(payload)).toBe(TradeFailureCode.INSUFFICIENT_LIQUIDITY);
    });

    it('returns UNKNOWN for empty input and passes known codes through', () => {
      expect(classifyTradeFailure(undefined)).toBe(TradeFailureCode.UNKNOWN);
      expect(classifyTradeFailure('')).toBe(TradeFailureCode.UNKNOWN);
      expect(classifyTradeFailure(TradeFailureCode.TIMEOUT)).toBe(TradeFailureCode.TIMEOUT);
      expect(isTradeFailureCode('nope')).toBe(false);
    });
  });

  describe('TradeExecutionFailedException', () => {
    it('is a BadRequestException with a stable, sanitized body', () => {
      const ex = new TradeExecutionFailedException(TradeFailureCode.INSUFFICIENT_LIQUIDITY, 't-1');
      expect(ex).toBeInstanceOf(BadRequestException);
      expect(ex.getStatus()).toBe(400);
      expect(ex.getResponse()).toEqual({
        statusCode: 400,
        error: 'Bad Request',
        code: 'TRADE_INSUFFICIENT_LIQUIDITY',
        message: getTradeFailure(TradeFailureCode.INSUFFICIENT_LIQUIDITY).message,
        retryable: true,
        tradeId: 't-1',
      });
    });

    it('never exposes stack traces, secrets, or provider payloads', () => {
      const secret = 'SDSECRETSEEDXYZ';
      const raw = new Error(
        `tx_failed for ${secret}\n    at TradeExecutorService.executeTrade (/app/src/x.ts:10:5)`,
      );
      raw.stack = `Error: boom\n    at Object.<anonymous> (/app/src/trade.ts:1:1)`;
      const body = JSON.stringify(TradeExecutionFailedException.fromError(raw).getResponse());
      expect(body).not.toContain(secret);
      expect(body).not.toContain('/app/src');
      expect(body).not.toContain('tx_failed');
      expect(body).toContain(TradeFailureCode.PROVIDER_REJECTED);
    });

    it('maps a timeout failure', () => {
      const ex = TradeExecutionFailedException.fromError('deadline exceeded');
      expect(ex.code).toBe(TradeFailureCode.TIMEOUT);
      expect((ex.getResponse() as { retryable: boolean }).retryable).toBe(true);
    });
  });
});
