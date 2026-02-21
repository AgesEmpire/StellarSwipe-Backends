import { StrategyTemplate } from '../entities/strategy-template.entity';

export const aggressiveTemplate: StrategyTemplate = {
  id: 'aggressive',
  name: 'Aggressive',
  description:
    'High-risk, high-reward strategy with wider stop-losses and maximum position diversity.',
  riskLevel: 'aggressive',
  parameters: {
    minProviderReputation: 40,
    maxOpenPositions: 10,
    defaultStopLoss: 20,
    minSignalConfidence: 40,
    preferredAssets: ['BTC', 'ETH', 'BNB', 'SOL', 'ADA', 'DOGE', 'SHIB', 'AVAX', 'DOT', 'LINK'],
    maxPositionSize: 20,
  },
  isCustom: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
