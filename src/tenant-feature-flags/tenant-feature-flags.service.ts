import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  FeatureFlagDefinition,
  FeatureFlagEvaluation,
} from './tenant-feature-flags.types';

/**
 * Runtime feature-flag layer.
 *
 * Flags are defined in-memory (seeded from FEATURE_FLAGS_JSON env var when present) so
 * toggles, rollout percentages, and env-scoped overrides can change without a redeploy —
 * update the env var / backing store and call refresh(). This is intentionally storage
 * agnostic: swap `loadDefinitions` for a DB/remote-config read to persist changes.
 */
@Injectable()
export class TenantFeatureFlagsService {
  private readonly logger = new Logger(TenantFeatureFlagsService.name);
  private flags = new Map<string, FeatureFlagDefinition>();
  private readonly env: string;

  constructor(private readonly configService: ConfigService) {
    this.env = this.configService.get<string>('NODE_ENV') ?? 'development';
    this.loadDefinitions();
  }

  /** Reloads flag definitions. Call after updating the backing store/env var. */
  refresh(): void {
    this.loadDefinitions();
  }

  private loadDefinitions(): void {
    const raw = this.configService.get<string>('FEATURE_FLAGS_JSON');
    const defs: FeatureFlagDefinition[] = raw ? this.safeParse(raw) : [];
    this.flags = new Map(defs.map((d) => [d.key, d]));
    this.logger.log(`Loaded ${this.flags.size} feature flag definition(s)`);
  }

  private safeParse(raw: string): FeatureFlagDefinition[] {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      this.logger.warn(`Failed to parse FEATURE_FLAGS_JSON: ${(err as Error).message}`);
      return [];
    }
  }

  registerDefaults(defs: FeatureFlagDefinition[]): void {
    for (const def of defs) {
      if (!this.flags.has(def.key)) {
        this.flags.set(def.key, def);
      }
    }
  }

  isEnabled(key: string, tenantId?: string): boolean {
    return this.evaluate(key, tenantId).enabled;
  }

  evaluate(key: string, tenantId?: string): FeatureFlagEvaluation {
    const def = this.flags.get(key);
    if (!def) {
      this.logger.debug(`Unknown feature flag "${key}" requested, defaulting to disabled`);
      return { key, tenantId, env: this.env, enabled: false, reason: 'unknown-flag' };
    }

    const override = (def.overrides ?? []).find(
      (o) =>
        (o.env === undefined || o.env === this.env) &&
        (o.tenantId === undefined || o.tenantId === tenantId),
    );
    if (override) {
      return { key, tenantId, env: this.env, enabled: override.enabled, reason: 'override' };
    }

    if (typeof def.rolloutPercentage === 'number' && tenantId) {
      const enabled = this.isInRollout(key, tenantId, def.rolloutPercentage);
      return { key, tenantId, env: this.env, enabled, reason: 'rollout' };
    }

    return { key, tenantId, env: this.env, enabled: def.defaultEnabled, reason: 'default' };
  }

  listFlags(): FeatureFlagDefinition[] {
    return Array.from(this.flags.values());
  }

  /** Deterministic bucketing so the same tenant always lands in the same rollout bucket. */
  private isInRollout(key: string, tenantId: string, percentage: number): boolean {
    if (percentage <= 0) return false;
    if (percentage >= 100) return true;
    const hash = crypto.createHash('sha256').update(`${key}:${tenantId}`).digest();
    const bucket = hash.readUInt32BE(0) % 100;
    return bucket < percentage;
  }
}
