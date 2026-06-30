/**
 * Returns the risk-gate configuration reading env vars at call time.
 * Using a getter function (rather than a module-level const) ensures tests
 * can override env variables between calls without module cache issues.
 */
export function getRiskGateConfig() {
  return {
    maxTradeSizeUSD: Number(process.env.RISK_MAX_TRADE_USD ?? 5_000),
    minBalanceBufferUSD: Number(process.env.RISK_MIN_BALANCE_USD ?? 10),
  };
}

/** @deprecated use getRiskGateConfig() — kept for backwards compatibility */
export const RISK_GATE_CONFIG = getRiskGateConfig();

export const RISK_CODES = {
  INSUFFICIENT_BALANCE: 'RISK_001',
  TRADE_SIZE_EXCEEDED: 'RISK_002',
  POSITION_LIMIT: 'RISK_003',
} as const;

export type RiskCode = (typeof RISK_CODES)[keyof typeof RISK_CODES];
