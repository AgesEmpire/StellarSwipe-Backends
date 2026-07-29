import { Injectable, NotFoundException, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
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

  constructor(
    @InjectRepository(FeatureFlag)
    private flagRepository: Repository<FeatureFlag>,
    @InjectRepository(FlagAssignment)
    private assignmentRepository: Repository<FlagAssignment>,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

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
    const cached = await this.cacheManager.get<FlagEvaluationResult>(cacheKey);
    if (cached) return cached;

    const flag = await this.getFlag(flagName);

    if (!flag.enabled) {
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

      case 'percentage':
        const hash = this.hashUser(userId, flagName);
        result = { enabled: hash % 100 < (flag.config.percentage || 0) };
        break;

      case 'userList':
        result = { enabled: flag.config.userList?.includes(userId) || false };
        break;

      case 'abTest':
        const variant = this.assignVariant(userId, flag.config.variants || []);
        result = { enabled: true, variant };
        break;

      default:
        result = { enabled: false };
    }

    await this.saveAssignment(userId, flagName, result);
    await this.cacheManager.set(cacheKey, result, 60000); // 1 min
    return result;
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
}
