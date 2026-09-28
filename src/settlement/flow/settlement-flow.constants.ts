export const SETTLEMENT_QUEUES = {
  PIPELINE: 'settlement-pipeline',
  STEPS: 'settlement-steps',
} as const;

export const SETTLEMENT_JOBS = {
  PIPELINE: 'settlement-pipeline',
  CONFIRM_ON_CHAIN: 'confirm-on-chain',
  UPDATE_BALANCES: 'update-balances',
  RECORD_PNL: 'record-pnl',
  NOTIFY_USER: 'notify-user',
} as const;

export interface SettlementFlowData {
  tradeId: string;
  userId: string;
  amount: string;
  txHash: string;
  entryPrice: string;
  exitPrice?: string;
  baseAsset: string;
  counterAsset: string;
}
