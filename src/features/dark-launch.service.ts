import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

export interface DarkLaunchConfig {
  /** Feature key, e.g. "new-payment-flow" */
  feature: string;
  /**
   * Percentage of traffic (0-100) that sees the feature.
   * 0 = nobody (dark), 100 = full rollout.
   */
  rolloutPercentage: number;
  /** Explicit user IDs always included regardless of percentage */
  allowlist?: string[];
  /**
   * When true the guard NEVER blocks the request — it only logs
   * whether the user would have been included. Safe for shadow-testing.
   */
  observerOnly?: boolean;
}

export interface DarkLaunchResult {
  feature: string;
  enabled: boolean;
  observerOnly: boolean;
  reason: 'allowlist' | 'rollout' | 'excluded' | 'observer';
}

@Injectable()
export class DarkLaunchService {
  private readonly logger = new Logger(DarkLaunchService.name);

  /**
   * In-memory registry. In production you would back this with Redis /
   * the existing FeatureFlagsService — the interface is intentionally
   * compatible with FeatureFlag so migration is a one-liner swap.
   */
  private readonly registry = new Map<string, DarkLaunchConfig>();

  // ── Registry management ────────────────────────────────────────────

  register(config: DarkLaunchConfig): void {
    this.registry.set(config.feature, config);
    this.logger.log(
      `Dark-launch registered: ${config.feature} ` +
        `rollout=${config.rolloutPercentage}% ` +
        `observerOnly=${config.observerOnly ?? false}`,
    );
  }

  update(feature: string, patch: Partial<Omit<DarkLaunchConfig, 'feature'>>): void {
    const existing = this.registry.get(feature);
    if (!existing) {
      this.logger.warn(`Dark-launch update: unknown feature "${feature}"`);
      return;
    }
    this.registry.set(feature, { ...existing, ...patch });
    this.logger.log(`Dark-launch updated: ${feature} → ${JSON.stringify(patch)}`);
  }

  remove(feature: string): void {
    this.registry.delete(feature);
  }

  getConfig(feature: string): DarkLaunchConfig | undefined {
    return this.registry.get(feature);
  }

  listAll(): DarkLaunchConfig[] {
    return Array.from(this.registry.values());
  }

  // ── Evaluation ─────────────────────────────────────────────────────

  evaluate(feature: string, userId: string): DarkLaunchResult {
    const config = this.registry.get(feature);

    if (!config) {
      // Unknown feature → treat as fully dark (safe default)
      return { feature, enabled: false, observerOnly: false, reason: 'excluded' };
    }

    if (config.observerOnly) {
      // Shadow mode: log but never gate
      const wouldBeEnabled = this.isInRollout(userId, feature, config);
      this.logger.debug(
        `[observer] ${feature} user=${userId} wouldBeEnabled=${wouldBeEnabled}`,
      );
      return { feature, enabled: true, observerOnly: true, reason: 'observer' };
    }

    if (config.allowlist?.includes(userId)) {
      return { feature, enabled: true, observerOnly: false, reason: 'allowlist' };
    }

    const enabled = this.isInRollout(userId, feature, config);
    return {
      feature,
      enabled,
      observerOnly: false,
      reason: enabled ? 'rollout' : 'excluded',
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  /**
   * Deterministic, sticky hash so the same user always gets the same
   * result for a given feature across restarts.
   */
  private isInRollout(userId: string, feature: string, config: DarkLaunchConfig): boolean {
    if (config.rolloutPercentage <= 0) return false;
    if (config.rolloutPercentage >= 100) return true;

    const hash = createHash('sha256')
      .update(`${feature}:${userId}`)
      .digest('hex');
    const bucket = parseInt(hash.slice(0, 8), 16) % 100;
    return bucket < config.rolloutPercentage;
  }
}
