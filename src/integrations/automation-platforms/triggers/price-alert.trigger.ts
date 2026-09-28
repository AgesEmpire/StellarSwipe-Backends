import { AutomationTrigger } from '../interfaces/automation-hook.interface';

export const priceAlertTrigger: AutomationTrigger = {
  id: 'price_alert',
  name: 'Price Alert',
  description: 'Fires when an asset price crosses a configured threshold',
  samplePayload: {
    symbol: 'XLM/USDC',
    currentPrice: '0.18',
    targetPrice: '0.18',
    direction: 'above',
    triggeredAt: '2024-01-01T00:00:00.000Z',
  },
};
