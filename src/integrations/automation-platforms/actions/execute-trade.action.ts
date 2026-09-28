import { AutomationAction } from '../interfaces/automation-hook.interface';

export const executeTradeAction: AutomationAction = {
  id: 'execute_trade',
  name: 'Execute Trade',
  description: 'Execute a trade on the Stellar DEX based on a signal',
  inputFields: [
    { key: 'userId', label: 'User ID', type: 'string', required: true },
    { key: 'signalId', label: 'Signal ID', type: 'string', required: true },
    { key: 'amount', label: 'Amount', type: 'number', required: true },
    { key: 'walletAddress', label: 'Wallet Address', type: 'string', required: true },
  ],
};
