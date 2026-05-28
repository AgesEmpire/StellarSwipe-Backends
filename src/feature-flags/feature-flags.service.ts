import { Injectable, NotFoundException, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { FeatureFlag } from './entities/feature-flag.entity';
import { FlagAssignment } from './entities/flag-assignment.entity';
import { CreateFlagDto, UpdateFlagDto } from './dto/create-flag.dto';
import { FlagEvaluationResult } from './dto/evaluate-flag.dto';

@Injectable()
export class FeatureFlagsService {
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

  async evaluateFlag(flagName: string, userId: string): Promise<FlagEvaluationResult> {
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
