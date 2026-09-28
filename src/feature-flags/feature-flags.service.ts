import { Injectable, NotFoundException, Inject, Logger, OnModuleInit } from '@nestjs/common';
import {
  Injectable,
  NotFoundException,
  Inject,
  Logger,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { FeatureFlag } from './entities/feature-flag.entity';
import { FlagAssignment } from './entities/flag-assignment.entity';
import { CreateFlagDto, UpdateFlagDto } from './dto/create-flag.dto';
import { FlagEvaluationContext, FlagEvaluationResult } from './dto/evaluate-flag.dto';

/** High-risk workflows gated behind a flag, seeded enabled so existing behavior is preserved until an operator dials rollout back. */
const DEFAULT_HIGH_RISK_FLAGS: Pick<CreateFlagDto, 'name' | 'description' | 'type' | 'enabled'>[] = [
  { name: 'admin.user-suspension', description: 'Admin-triggered user suspension/unsuspension', type: 'boolean', enabled: true },
  { name: 'payments.refunds', description: 'Payment refund processing', type: 'boolean', enabled: true },
];

@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsService.name);

import { FlagEvaluationResult } from './dto/evaluate-flag.dto';
import { TenantConfigService } from '../config/tenant-config.service';

/**
 * Required flags that must exist at startup.
 * Each entry defines the flag name and its safe default when missing.
 * Add new required flags here — the startup validator will auto-seed them.
 */
const REQUIRED_FLAGS: Array<{ name: string; description: string; enabled: boolean }> = [
  { name: 'trade-execution', description: 'Enable trade execution flow', enabled: true },
  { name: 'signal-feed', description: 'Enable signal feed for users', enabled: true },
  { name: 'copy-trading', description: 'Enable copy-trading feature', enabled: true },
  { name: 'provider-onboarding', description: 'Enable provider onboarding flow', enabled: false },
  { name: 'kyc-required', description: 'Enforce KYC before trading', enabled: false },
  {
    name: 'search-index-refresh',
    description: 'Enable automatic search-index refresh hooks after signal/provider/content writes',
    enabled: true,
  },
];

@Injectable()
export class FeatureFlagsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(FeatureFlagsService.name);

  /** Flags that are force-enabled/disabled via environment variables.
   *  Format: FEATURE_FLAG_<NAME>=true|false  (NAME uppercased, hyphens→underscores)
   */
  private readonly envOverrides: Map<string, boolean>;

  constructor(
    @InjectRepository(FeatureFlag)
    private flagRepository: Repository<FeatureFlag>,
    @InjectRepository(FlagAssignment)
    private assignmentRepository: Repository<FlagAssignment>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
    private readonly config: ConfigService,
    // Optional so existing tests/modules that don't provide a
    // TenantConfigService keep working unchanged — tenant overrides simply
    // resolve to undefined (no-op) in that case.
    @Optional()
    private readonly tenantConfig?: TenantConfigService,
  ) {
    this.envOverrides = this.loadEnvOverrides();
  }

  private loadEnvOverrides(): Map<string, boolean> {
    const overrides = new Map<string, boolean>();
    const raw = this.config.get<string>('FEATURE_FLAGS_OVERRIDES', '');
    if (!raw) return overrides;
    for (const pair of raw.split(',')) {
      const [name, val] = pair.split('=').map((s) => s.trim());
      if (name && (val === 'true' || val === 'false')) {
        overrides.set(name, val === 'true');
      }
    }
    return overrides;
  }

  async onModuleInit(): Promise<void> {
    for (const defaults of DEFAULT_HIGH_RISK_FLAGS) {
      const existing = await this.flagRepository.findOne({ where: { name: defaults.name } });
      if (!existing) {
        await this.flagRepository.save(this.flagRepository.create({ ...defaults, config: {} }));
        this.logger.log(`Seeded default feature flag "${defaults.name}" (enabled=${defaults.enabled})`);
      }
    }
  }

  async createFlag(dto: CreateFlagDto): Promise<FeatureFlag> {
    const flag = this.flagRepository.create(dto);
    await this.flagRepository.save(flag);
    await this.invalidateCache(flag.name);
    return flag;
  }

  async updateFlag(name: string, dto: UpdateFlagDto): Promise<FeatureFlag> {
    const flag = await this.flagRepository.findOne({ where: { name } });
    if (!flag) throw new NotFoundException(`Flag ${name} not found`);
    
    Object.assign(flag, dto);
    await this.flagRepository.save(flag);
    await this.invalidateCache(name);
    return flag;
  }

  async deleteFlag(name: string): Promise<void> {
    await this.flagRepository.delete({ name });
    await this.assignmentRepository.delete({ flagName: name });
    await this.invalidateCache(name);
  }

  async getFlag(name: string): Promise<FeatureFlag> {
    const cacheKey = `flag:${name}`;
    const cached = await this.cacheManager.get<FeatureFlag>(cacheKey);
    if (cached) return cached;

    const flag = await this.flagRepository.findOne({ where: { name } });
    if (!flag) throw new NotFoundException(`Flag ${name} not found`);

    await this.cacheManager.set(cacheKey, flag, 300000); // 5 min
    return flag;
  }

  async getAllFlags(): Promise<FeatureFlag[]> {
    return this.flagRepository.find();
  }

  async evaluateFlag(
    flagName: string,
    userId: string,
    context: FlagEvaluationContext = {},
  ): Promise<FlagEvaluationResult> {
    try {
      return await this.doEvaluateFlag(flagName, userId, context);
    } catch (error) {
      // Never let a misconfigured/missing flag or an infra hiccup (DB, cache)
      // take down the calling workflow — fail safe to disabled and log why.
      this.logger.warn(
        `Feature flag "${flagName}" evaluation failed for user ${userId} — falling back to disabled: ${(error as Error).message}`,
      );
      return { enabled: false, fallback: true, reason: (error as Error).message };
    }
  }

  private async doEvaluateFlag(
    flagName: string,
    userId: string,
    context: FlagEvaluationContext,
  ): Promise<FlagEvaluationResult> {
    const cacheKey = `eval:${flagName}:${userId}:${context.tenantId ?? '-'}:${context.environment ?? '-'}`;
  async evaluateFlag(flagName: string, userId: string): Promise<FlagEvaluationResult> {
    // Tenant override takes highest precedence — an explicit per-tenant
    // decision (#943) should win over both the env override and the flag's
    // own configuration. Falls through (undefined) when there's no active
    // tenant context or no override configured for this tenant/flag.
    const tenantOverride = this.tenantConfig?.resolveFeatureFlagOverride(flagName);
    if (tenantOverride !== undefined) {
      this.logger.log(
        `[FeatureFlag] '${flagName}' resolved via tenant override → ${tenantOverride} (userId=${userId})`,
      );
      return { enabled: tenantOverride };
    }

    // Env override takes precedence — log when it affects the request path
    if (this.envOverrides.has(flagName)) {
      const overrideValue = this.envOverrides.get(flagName)!;
      this.logger.log(
        `[FeatureFlag] '${flagName}' resolved via env override → ${overrideValue} (userId=${userId})`,
      );
      return { enabled: overrideValue };
    }

    const cacheKey = `eval:${flagName}:${userId}`;
    const cached = await this.cacheManager.get<FlagEvaluationResult>(cacheKey);
    if (cached) return cached;

    const flag = await this.getFlag(flagName);

    if (!flag.enabled) {
      this.logger.debug(`[FeatureFlag] '${flagName}' is disabled — skipping for userId=${userId}`);
      return { enabled: false };
    }

    const environment = context.environment ?? process.env.NODE_ENV ?? 'development';
    if (flag.environments && flag.environments.length > 0 && !flag.environments.includes(environment)) {
      this.logger.log(
        `Feature flag "${flagName}" disabled in environment "${environment}" (allowed: ${flag.environments.join(', ')})`,
      );
      return { enabled: false, reason: `not enabled for environment "${environment}"` };
    }

    if (flag.config.tenantAllowList && flag.config.tenantAllowList.length > 0) {
      if (!context.tenantId || !flag.config.tenantAllowList.includes(context.tenantId)) {
        this.logger.log(
          `Feature flag "${flagName}" disabled for tenant "${context.tenantId ?? 'unknown'}" (not in allow list)`,
        );
        return { enabled: false, reason: 'tenant not in allow list' };
      }
    }

    let result: FlagEvaluationResult;

    switch (flag.type) {
      case 'boolean':
        result = { enabled: true };
        break;

      case 'percentage': {
        const hash = this.hashUser(userId, flagName);
        result = { enabled: hash % 100 < (flag.config.percentage || 0) };
        break;
      }

      case 'userList':
        result = { enabled: flag.config.userList?.includes(userId) || false };
        break;

      case 'abTest': {
        const variant = this.assignVariant(userId, flag.config.variants || []);
        result = { enabled: true, variant };
        break;
      }

      default:
        result = { enabled: false };
    }

    this.logger.log(
      `[FeatureFlag] '${flagName}' evaluated → enabled=${result.enabled}${
        result.variant ? ` variant=${result.variant}` : ''
      } (userId=${userId})`,
    );

    await this.saveAssignment(userId, flagName, result);
    await this.cacheManager.set(cacheKey, result, 60000);
    return result;
  }

  /**
   * System-level flag check for backend behaviors that aren't scoped to a
   * specific user (background jobs, event listeners, internal toggles).
   * Unlike evaluateFlag(), this does not perform per-user targeting/A-B
   * assignment — it simply resolves whether the flag is "on", honoring the
   * same env-override mechanism (FEATURE_FLAGS_OVERRIDES) as evaluateFlag().
   * Missing flags resolve to false (fail closed) so new/experimental
   * behaviors default off until explicitly enabled.
   */
  async isFlagEnabled(flagName: string): Promise<boolean> {
    if (this.envOverrides.has(flagName)) {
      return this.envOverrides.get(flagName)!;
    }

    try {
      const flag = await this.getFlag(flagName);
      return flag.enabled;
    } catch {
      this.logger.warn(`[FeatureFlag] '${flagName}' not found — defaulting to disabled`);
      return false;
    }
  }

  private hashUser(userId: string, flagName: string): number {
    const hash = createHash('md5')
      .update(`${userId}:${flagName}`)
      .digest('hex');
    return parseInt(hash.substring(0, 8), 16);
  }

  private assignVariant(userId: string, variants: { name: string; percentage: number }[]): string {
    if (!variants.length) return 'control';

    const hash = this.hashUser(userId, 'variant');
    const position = hash % 100;
    
    let cumulative = 0;
    for (const variant of variants) {
      cumulative += variant.percentage;
      if (position < cumulative) return variant.name;
    }
    
    return variants[0].name;
  }

  private async saveAssignment(userId: string, flagName: string, result: FlagEvaluationResult): Promise<void> {
    const existing = await this.assignmentRepository.findOne({ where: { userId, flagName } });
    
    if (existing) {
      existing.enabled = result.enabled;
      existing.variant = result.variant;
      await this.assignmentRepository.save(existing);
    } else {
      const assignment = this.assignmentRepository.create({
        userId,
        flagName,
        enabled: result.enabled,
        variant: result.variant,
      });
      await this.assignmentRepository.save(assignment);
    }
  }

  private async invalidateCache(flagName: string): Promise<void> {
    await this.cacheManager.del(`flag:${flagName}`);
  }

  async getUserAssignments(userId: string): Promise<FlagAssignment[]> {
    return this.assignmentRepository.find({ where: { userId } });
  }

  async isEntrypointKilled(contractId: string, method: string): Promise<boolean> {
    const cacheKey = `entrypoint:${contractId}:${method}:killed`;
    const cached = await this.cacheManager.get<boolean>(cacheKey);
    if (cached !== undefined) return cached;

    const flag = await this.flagRepository.findOne({
      where: {
        contractId,
        method,
        type: 'boolean',
        enabled: true,
        retired: false,
      },
    });

    const isKilled = !flag;

    await this.cacheManager.set(cacheKey, isKilled, 60000);
    return isKilled;
  }

  async checkEntrypointAccess(
    contractId: string,
    method: string,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (this.envOverrides.has(`ENTRYPOINT_KILL_${contractId}_${method}`)) {
      const isKilled = this.envOverrides.get(
        `ENTRYPOINT_KILL_${contractId}_${method}`,
      )!;
      if (isKilled) {
        return {
          allowed: false,
          reason: `Entrypoint ${contractId}.${method} is temporarily disabled`,
        };
      }
    }

    const isKilled = await this.isEntrypointKilled(contractId, method);
    if (isKilled) {
      this.logger.warn(
        `[FeatureFlag] Entrypoint ${contractId}.${method} is killed`,
      );
      return {
        allowed: false,
        reason: `Entrypoint ${contractId}.${method} is temporarily disabled`,
      };
    }

    return { allowed: true };
  }
}
