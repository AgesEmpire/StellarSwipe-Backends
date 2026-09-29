import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FEATURE_FLAG_SCHEMA, validateFeatureFlagConfig } from './feature-flag-config.validator';

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
   * Initialize feature flags from environment. Configuration is validated
   * against FEATURE_FLAG_SCHEMA and a malformed value aborts startup.
   */
  private initializeFlags(): void {
    this.logger.log('Initializing feature flags...');

    const env: Record<string, string | undefined> = { ...process.env };
    for (const def of FEATURE_FLAG_SCHEMA) {
      for (const key of [def.envKey, `${def.envKey}_ROLLOUT`]) {
        const value = this.configService.get<string>(key);
        if (value !== undefined) env[key] = String(value);
      }
    }
    env.NODE_ENV = this.configService.get<string>('NODE_ENV') ?? env.NODE_ENV;

    try {
      validateFeatureFlagConfig(env).forEach((flag) => this.flags.set(flag.name, flag));
    } catch (error) {
      this.logger.error((error as Error).message);
      throw error;
    }

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
}
