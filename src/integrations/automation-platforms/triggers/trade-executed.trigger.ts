import { AutomationTrigger } from '../interfaces/automation-hook.interface';

export const tradeExecutedTrigger: AutomationTrigger = {
  id: 'trade_executed',
  name: 'Trade Executed',
  description: 'Fires when a trade is successfully executed on the Stellar network',
  samplePayload: {
    tradeId: 'trade_789',
    userId: 'user_123',
    symbol: 'XLM/USDC',
    side: 'BUY',
    amount: '100',
    entryPrice: '0.15',
    totalValue: '15.00',
    transactionHash: 'abc123...',
    executedAt: '2024-01-01T00:00:00.000Z',
  },
};
