import { AutomationTrigger } from '../interfaces/automation-hook.interface';

export const newSignalTrigger: AutomationTrigger = {
  id: 'new_signal',
  name: 'New Signal',
  description: 'Fires when a new trading signal is created by a provider',
  samplePayload: {
    signalId: 'sig_123',
    providerId: 'prov_456',
    symbol: 'XLM/USDC',
    type: 'BUY',
    entryPrice: '0.15',
    targetPrice: '0.18',
    stopLossPrice: '0.14',
    confidenceScore: 85,
    createdAt: '2024-01-01T00:00:00.000Z',
  },
};
