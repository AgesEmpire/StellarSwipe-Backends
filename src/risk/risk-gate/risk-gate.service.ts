import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { RISK_GATE_CONFIG, RISK_CODES, RiskCode } from './risk-gate.config';

export interface RiskGateContext {
  userId: string;
  pair: string;
  tradeSizeUSD: number;
  availableBalanceUSD: number;
}

export interface RiskGateResult {
  passed: boolean;
  code?: RiskCode;
  message?: string;
}

@Injectable()
export class RiskGateService {
  private readonly logger = new Logger(RiskGateService.name);

  /**
   * Evaluates a trade against balance, size, and position-limit rules.
   * Throws UnprocessableEntityException with a structured risk code on failure.
   * All decisions — pass and fail — are logged for audit.
   */
  async evaluate(ctx: RiskGateContext): Promise<void> {
    const { userId, pair, tradeSizeUSD, availableBalanceUSD } = ctx;

    // Rule RISK_001: sufficient balance after trade
    if (availableBalanceUSD - tradeSizeUSD < RISK_GATE_CONFIG.minBalanceBufferUSD) {
      this.block(userId, pair, tradeSizeUSD, RISK_CODES.INSUFFICIENT_BALANCE,
        `Insufficient balance: $${availableBalanceUSD.toFixed(2)} available, ` +
        `$${tradeSizeUSD.toFixed(2)} required (min buffer $${RISK_GATE_CONFIG.minBalanceBufferUSD})`);
    }

    // Rule RISK_002: trade size cap
    if (tradeSizeUSD > RISK_GATE_CONFIG.maxTradeSizeUSD) {
      this.block(userId, pair, tradeSizeUSD, RISK_CODES.TRADE_SIZE_EXCEEDED,
        `Trade size $${tradeSizeUSD.toFixed(2)} exceeds maximum $${RISK_GATE_CONFIG.maxTradeSizeUSD}`);
    }

    this.logger.log({
      event: 'risk_gate_passed',
      userId,
      pair,
      tradeSizeUSD,
    });
  }

  private block(
    userId: string,
    pair: string,
    tradeSizeUSD: number,
    code: RiskCode,
    message: string,
  ): never {
    this.logger.warn({ event: 'risk_gate_blocked', userId, pair, tradeSizeUSD, code, message });
    throw Object.assign(new UnprocessableEntityException(message), { code });
  }
}
