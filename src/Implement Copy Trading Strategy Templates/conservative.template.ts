import { StrategyTemplate } from '../entities/strategy-template.entity';

export const conservativeTemplate: StrategyTemplate = {
  id: 'conservative',
  name: 'Conservative',
  description:
    'Low-risk strategy focusing on high-reputation providers with tight stop-losses and limited open positions.',
  riskLevel: 'conservative',
  parameters: {
    minProviderReputation: 80,
    maxOpenPositions: 3,
    defaultStopLoss: 5,
    minSignalConfidence: 80,
    preferredAssets: ['BTC', 'ETH', 'BNB'],
    maxPositionSize: 5,
  },
  isCustom: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
