import { AutomationAction } from '../interfaces/automation-hook.interface';

export const createSignalAction: AutomationAction = {
  id: 'create_signal',
  name: 'Create Signal',
  description: 'Create a new trading signal as a provider',
  inputFields: [
    { key: 'providerId', label: 'Provider ID', type: 'string', required: true },
    { key: 'symbol', label: 'Symbol (e.g. XLM/USDC)', type: 'string', required: true },
    { key: 'type', label: 'Signal Type (BUY/SELL)', type: 'string', required: true },
    { key: 'entryPrice', label: 'Entry Price', type: 'number', required: true },
    { key: 'targetPrice', label: 'Target Price', type: 'number', required: true },
    { key: 'stopLossPrice', label: 'Stop Loss Price', type: 'number', required: false },
  ],
};
