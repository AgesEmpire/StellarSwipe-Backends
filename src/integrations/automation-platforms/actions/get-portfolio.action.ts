import { AutomationAction } from '../interfaces/automation-hook.interface';

export const getPortfolioAction: AutomationAction = {
  id: 'get_portfolio',
  name: 'Get Portfolio',
  description: 'Retrieve current portfolio positions and performance for a user',
  inputFields: [
    { key: 'userId', label: 'User ID', type: 'string', required: true },
  ],
};
