import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FeatureFlag {
  name: string;
  enabled: boolean;
  description?: string;
  rolloutPercentage?: number; // 0-100
  targetUsers?: string[]; // User IDs to target
  targetRoles?: string[]; // Roles to target
  metadata?: Record<string, any>;
}

export interface FlagContext {
  userId?: string;
  userRole?: string;
  email?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private flags: Map<string, FeatureFlag> = new Map();

  constructor(private configService: ConfigService) {
    this.initializeFlags();
  }

  /**
   * Initialize default feature flags from environment
   */
  private initializeFlags(): void {
    this.logger.log('Initializing feature flags...');

    // Default flags - can be configured via environment variables
    const defaultFlags: FeatureFlag[] = [
      {
        name: 'new_portfolio_ui',
        enabled: this.getEnvBoolean('FF_NEW_PORTFOLIO_UI', false),
        description: 'Gradual rollout of new portfolio UI',
        rolloutPercentage: parseInt(
          process.env.FF_NEW_PORTFOLIO_UI_ROLLOUT || '0',
          10,
        ),
      },
      {
        name: 'advanced_analytics',
        enabled: this.getEnvBoolean('FF_ADVANCED_ANALYTICS', false),
        description: 'Advanced analytics features',
        rolloutPercentage: parseInt(
          process.env.FF_ADVANCED_ANALYTICS_ROLLOUT || '0',
          10,
        ),
      },
      {
        name: 'soroban_contracts',
        enabled: this.getEnvBoolean('FF_SOROBAN_CONTRACTS', false),
        description: 'Soroban smart contract integration',
        rolloutPercentage: parseInt(
          process.env.FF_SOROBAN_CONTRACTS_ROLLOUT || '0',
          10,
        ),
      },
      {
        name: 'automated_trading',
        enabled: this.getEnvBoolean('FF_AUTOMATED_TRADING', false),
        description: 'Automated trading features',
        rolloutPercentage: parseInt(
          process.env.FF_AUTOMATED_TRADING_ROLLOUT || '0',
          10,
        ),
      },
      {
        name: 'signal_marketplace',
        enabled: this.getEnvBoolean('FF_SIGNAL_MARKETPLACE', false),
        description: 'Signal marketplace features',
        rolloutPercentage: parseInt(
          process.env.FF_SIGNAL_MARKETPLACE_ROLLOUT || '0',
          10,
        ),
      },
    ];

    defaultFlags.forEach((flag) => {
      this.flags.set(flag.name, flag);
    });

    this.logger.log(`Initialized ${this.flags.size} feature flags`);
  }

  /**
   * Check if a feature flag is enabled for a user
   */
  isFeatureEnabled(
    flagName: string,
    context?: FlagContext,
  ): boolean {
    const flag = this.flags.get(flagName);

    if (!flag) {
      this.logger.warn(`Feature flag "${flagName}" does not exist`);
      return false;
    }

    // If flag is not enabled at all, return false
    if (!flag.enabled) {
      return false;
    }

    // If no context provided, use global enabled status
    if (!context) {
      return flag.rolloutPercentage === undefined || flag.rolloutPercentage >= 100;
    }

    // Check target users
    if (flag.targetUsers && flag.targetUsers.length > 0) {
      if (context.userId && flag.targetUsers.includes(context.userId)) {
        return true;
      }
    }

    // Check target roles
    if (flag.targetRoles && flag.targetRoles.length > 0) {
      if (context.userRole && flag.targetRoles.includes(context.userRole)) {
        return true;
      }
    }

    // Check rollout percentage
    if (
      flag.rolloutPercentage !== undefined &&
      flag.rolloutPercentage < 100
    ) {
      return this.isUserInRollout(context.userId || context.email || '', flag.rolloutPercentage);
    }

    return flag.enabled;
  }

  /**
   * Register or update a feature flag
   */
  registerFlag(flag: FeatureFlag): void {
    this.flags.set(flag.name, flag);
    this.logger.log(`Registered feature flag: ${flag.name}`);
  }

  /**
   * Get all feature flags
   */
  getAllFlags(): FeatureFlag[] {
    return Array.from(this.flags.values());
  }

  /**
   * Get a specific feature flag
   */
  getFlag(name: string): FeatureFlag | undefined {
    return this.flags.get(name);
  }

  /**
   * Enable a feature flag
   */
  enableFlag(name: string): void {
    const flag = this.flags.get(name);
    if (flag) {
      flag.enabled = true;
      flag.rolloutPercentage = 100;
      this.logger.log(`Enabled feature flag: ${name}`);
    }
  }

  /**
   * Disable a feature flag
   */
  disableFlag(name: string): void {
    const flag = this.flags.get(name);
    if (flag) {
      flag.enabled = false;
      this.logger.log(`Disabled feature flag: ${name}`);
    }
  }

  /**
   * Set rollout percentage for a feature flag
   */
  setRolloutPercentage(name: string, percentage: number): void {
    const flag = this.flags.get(name);
    if (flag) {
      if (percentage < 0 || percentage > 100) {
        throw new Error('Rollout percentage must be between 0 and 100');
      }
      flag.rolloutPercentage = percentage;
      flag.enabled = percentage > 0;
      this.logger.log(
        `Set rollout percentage for ${name} to ${percentage}%`,
      );
    }
  }

  /**
   * Add user to target list
   */
  addTargetUser(flagName: string, userId: string): void {
    const flag = this.flags.get(flagName);
    if (flag) {
      if (!flag.targetUsers) {
        flag.targetUsers = [];
      }
      if (!flag.targetUsers.includes(userId)) {
        flag.targetUsers.push(userId);
        this.logger.debug(`Added user ${userId} to flag ${flagName}`);
      }
    }
  }

  /**
   * Remove user from target list
   */
  removeTargetUser(flagName: string, userId: string): void {
    const flag = this.flags.get(flagName);
    if (flag && flag.targetUsers) {
      const index = flag.targetUsers.indexOf(userId);
      if (index > -1) {
        flag.targetUsers.splice(index, 1);
        this.logger.debug(`Removed user ${userId} from flag ${flagName}`);
      }
    }
  }

  /**
   * Determine if a user is in the rollout based on hash
   * Uses consistent hashing to ensure user always gets same result
   */
  private isUserInRollout(userId: string, percentage: number): boolean {
    if (percentage <= 0) return false;
    if (percentage >= 100) return true;

    // Simple hash function for user rollout distribution
    const hash = this.simpleHash(userId);
    return (hash % 100) < percentage;
  }

  /**
   * Simple hash function for consistent user distribution
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Parse boolean from environment variable
   */
  private getEnvBoolean(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
  }
}
