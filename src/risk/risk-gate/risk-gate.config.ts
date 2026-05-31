export const RISK_GATE_CONFIG = {
  maxTradeSizeUSD: Number(process.env.RISK_MAX_TRADE_USD ?? 5_000),
  minBalanceBufferUSD: Number(process.env.RISK_MIN_BALANCE_USD ?? 10),
};

export const RISK_CODES = {
  INSUFFICIENT_BALANCE: 'RISK_001',
  TRADE_SIZE_EXCEEDED: 'RISK_002',
  POSITION_LIMIT: 'RISK_003',
} as const;

export type RiskCode = (typeof RISK_CODES)[keyof typeof RISK_CODES];
