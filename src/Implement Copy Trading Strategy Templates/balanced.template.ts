import { StrategyTemplate } from '../entities/strategy-template.entity';

export const balancedTemplate: StrategyTemplate = {
  id: 'balanced',
  name: 'Balanced',
  description:
    'Moderate-risk strategy balancing growth and protection with diversified positions.',
  riskLevel: 'balanced',
  parameters: {
    minProviderReputation: 60,
    maxOpenPositions: 7,
    defaultStopLoss: 10,
    minSignalConfidence: 60,
    preferredAssets: ['BTC', 'ETH', 'BNB', 'SOL', 'ADA'],
    maxPositionSize: 10,
  },
  isCustom: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
