import { Controller, Get, Post, UseGuards, Req } from '@nestjs/common';
import { FeatureFlagsService } from './feature-flags.service';
import { RequireFlag } from './decorators/require-flag.decorator';
import { FeatureFlagGuard } from './guards/feature-flag.guard';

/**
 * Example 1: Using RequireFlag decorator with guard
 */
@Controller('signals')
@UseGuards(FeatureFlagGuard)
export class SignalsControllerExample {
  constructor(private flagsService: FeatureFlagsService) {}

  // New feed only accessible if flag enabled
  @Get('feed')
  @RequireFlag('new_feed_algorithm')
  async getNewFeed(@Req() req: any) {
    const variant = req.featureVariant; // Available if A/B test
    return { message: 'New feed', variant };
  }

  // Legacy feed always accessible
  @Get('feed-legacy')
  async getLegacyFeed() {
    return { message: 'Legacy feed' };
  }
}

/**
 * Example 2: Programmatic flag evaluation
 */
export class SignalsServiceExample {
  constructor(private flagsService: FeatureFlagsService) {}

  async getFeed(userId: string) {
    const result = await this.flagsService.evaluateFlag('new_feed_algorithm', userId);
    
    if (result.enabled) {
      return this.getNewFeedAlgorithm();
    }
    return this.getLegacyFeed();
  }

  private getNewFeedAlgorithm() {
    return { algorithm: 'v2', items: [] };
  }

  private getLegacyFeed() {
    return { algorithm: 'v1', items: [] };
  }
}

/**
 * Example 3: A/B Testing with variants
 */
export class TradeButtonExample {
  constructor(private flagsService: FeatureFlagsService) {}

  async getButtonConfig(userId: string) {
    const result = await this.flagsService.evaluateFlag('trade_button_color', userId);
    
    const colorMap = {
      control: '#007bff',
      green: '#28a745',
      blue: '#17a2b8',
    };

    return {
      color: colorMap[result.variant || 'control'],
      variant: result.variant,
    };
  }
}

/**
 * Example 4: Creating flags programmatically
 */
export class FlagSetupExample {
  constructor(private flagsService: FeatureFlagsService) {}

  async setupFlags() {
    // Boolean flag
    await this.flagsService.createFlag({
      name: 'advanced_charts',
      description: 'Enable advanced charting features',
      type: 'boolean',
      enabled: true,
    });

    // Percentage rollout
    await this.flagsService.createFlag({
      name: 'new_feed_algorithm',
      description: 'New feed algorithm - 25% rollout',
      type: 'percentage',
      enabled: true,
      config: { percentage: 25 },
    });

    // User list
    await this.flagsService.createFlag({
      name: 'beta_features',
      description: 'Beta features for selected users',
      type: 'userList',
      enabled: true,
      config: {
        userList: ['user-1', 'user-2', 'user-3'],
      },
    });

    // A/B test
    await this.flagsService.createFlag({
      name: 'trade_button_color',
      description: 'A/B test for trade button color',
      type: 'abTest',
      enabled: true,
      config: {
        variants: [
          { name: 'control', percentage: 50 },
          { name: 'green', percentage: 25 },
          { name: 'blue', percentage: 25 },
        ],
      },
    });
  }
}

/**
 * Example 5: Gradual rollout strategy
 */
export class GradualRolloutExample {
  constructor(private flagsService: FeatureFlagsService) {}

  async rolloutNewFeature() {
    // Day 1: 1% of users
    await this.flagsService.createFlag({
      name: 'new_feature',
      type: 'percentage',
      enabled: true,
      config: { percentage: 1 },
    });

    // Day 3: Increase to 10%
    await this.flagsService.updateFlag('new_feature', {
      config: { percentage: 10 },
    });

    // Day 7: Increase to 50%
    await this.flagsService.updateFlag('new_feature', {
      config: { percentage: 50 },
    });

    // Day 14: Full rollout
    await this.flagsService.updateFlag('new_feature', {
      config: { percentage: 100 },
    });

    // Day 30: Convert to boolean (cleanup)
    await this.flagsService.updateFlag('new_feature', {
      enabled: true,
    });
  }
}

/**
 * Example 6: Feature flag with fallback
 */
export class FeatureWithFallbackExample {
  constructor(private flagsService: FeatureFlagsService) {}

  async processSignal(userId: string, signal: any) {
    try {
      const result = await this.flagsService.evaluateFlag('ai_validation', userId);
      
      if (result.enabled) {
        return this.processWithAI(signal);
      }
    } catch (error) {
      // Flag evaluation failed, use fallback
      console.error('Flag evaluation failed:', error);
    }
    
    return this.processWithoutAI(signal);
  }

  private processWithAI(signal: any) {
    return { validated: true, method: 'ai' };
  }

  private processWithoutAI(signal: any) {
    return { validated: true, method: 'rules' };
  }
}

/**
 * Example 7: Multi-variant A/B test
 */
export class MultiVariantExample {
  constructor(private flagsService: FeatureFlagsService) {}

  async getRecommendationAlgorithm(userId: string) {
    const result = await this.flagsService.evaluateFlag('recommendation_algo', userId);
    
    switch (result.variant) {
      case 'collaborative':
        return this.collaborativeFiltering();
      case 'content_based':
        return this.contentBasedFiltering();
      case 'hybrid':
        return this.hybridApproach();
      default:
        return this.defaultRecommendations();
    }
  }

  private collaborativeFiltering() {
    return { algorithm: 'collaborative', items: [] };
  }

  private contentBasedFiltering() {
    return { algorithm: 'content_based', items: [] };
  }

  private hybridApproach() {
    return { algorithm: 'hybrid', items: [] };
  }

  private defaultRecommendations() {
    return { algorithm: 'default', items: [] };
  }
}
