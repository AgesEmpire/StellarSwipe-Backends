import { DataSource } from 'typeorm';
import { FeatureFlag } from '../../feature-flags/entities/feature-flag.entity';

export async function seedFeatureFlags(dataSource: DataSource): Promise<void> {
  const flagRepository = dataSource.getRepository(FeatureFlag);

  const flags = [
    {
      name: 'advanced_charts',
      description: 'Enable advanced charting features',
      type: 'boolean' as const,
      enabled: true,
      config: {},
    },
    {
      name: 'new_feed_algorithm',
      description: 'New feed algorithm - gradual rollout',
      type: 'percentage' as const,
      enabled: true,
      config: { percentage: 25 },
    },
    {
      name: 'beta_features',
      description: 'Beta features for selected users',
      type: 'userList' as const,
      enabled: true,
      config: {
        userList: [],
      },
    },
    {
      name: 'trade_button_color',
      description: 'A/B test for trade button color',
      type: 'abTest' as const,
      enabled: true,
      config: {
        variants: [
          { name: 'control', percentage: 50 },
          { name: 'green', percentage: 25 },
          { name: 'blue', percentage: 25 },
        ],
      },
    },
    {
      name: 'ai_signal_validation',
      description: 'AI-powered signal validation',
      type: 'percentage' as const,
      enabled: true,
      config: { percentage: 10 },
    },
    {
      name: 'dark_mode',
      description: 'Dark mode UI theme',
      type: 'boolean' as const,
      enabled: true,
      config: {},
    },
    {
      name: 'recommendation_algo',
      description: 'A/B test for recommendation algorithms',
      type: 'abTest' as const,
      enabled: true,
      config: {
        variants: [
          { name: 'control', percentage: 40 },
          { name: 'collaborative', percentage: 30 },
          { name: 'content_based', percentage: 30 },
        ],
      },
    },
  ];

  for (const flagData of flags) {
    const existing = await flagRepository.findOne({ where: { name: flagData.name } });
    if (!existing) {
      const flag = flagRepository.create(flagData);
      await flagRepository.save(flag);
      console.log(`Created flag: ${flagData.name}`);
    }
  }
}
