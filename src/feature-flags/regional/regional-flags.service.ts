import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { RegionalFlagConfig, RegionFlagStatus } from './entities/regional-flag-config.entity';
import {
  CreateRegionalFlagDto,
  UpdateRegionalFlagDto,
  RegionalFlagQueryDto,
  RegionalFlagEvaluationResult,
} from './dto/regional-flag.dto';
import { RegionResolver } from './utils/region-resolver';
import { FlagEvaluator } from './utils/flag-evaluator';

@Injectable()
export class RegionalFlagsService {
  constructor(
    @InjectRepository(RegionalFlagConfig)
    private configRepository: Repository<RegionalFlagConfig>,
    private regionResolver: RegionResolver,
    private flagEvaluator: FlagEvaluator,
  ) {}

  async create(dto: CreateRegionalFlagDto, createdBy: string): Promise<RegionalFlagConfig> {
    const config = this.configRepository.create({
      ...dto,
      enabledAt: dto.enabledAt ? new Date(dto.enabledAt) : null,
      disabledAt: dto.disabledAt ? new Date(dto.disabledAt) : null,
      updatedBy: createdBy,
    });
    return this.configRepository.save(config);
  }

  async update(
    flagName: string,
    region: string,
    dto: UpdateRegionalFlagDto,
    updatedBy: string,
  ): Promise<RegionalFlagConfig> {
    const config = await this.configRepository.findOne({ where: { flagName, region } });
    if (!config) {
      throw new NotFoundException(`Regional flag config not found for ${flagName}/${region}`);
    }

    Object.assign(config, {
      ...dto,
      enabledAt: dto.enabledAt !== undefined ? new Date(dto.enabledAt) : config.enabledAt,
      disabledAt: dto.disabledAt !== undefined ? new Date(dto.disabledAt) : config.disabledAt,
      updatedBy,
    });

    return this.configRepository.save(config);
  }

  async delete(flagName: string, region: string): Promise<void> {
    const result = await this.configRepository.delete({ flagName, region });
    if (result.affected === 0) {
      throw new NotFoundException(`Regional flag config not found for ${flagName}/${region}`);
    }
  }

  async findAll(query: RegionalFlagQueryDto): Promise<RegionalFlagConfig[]> {
    const where: Partial<RegionalFlagConfig> = {};
    if (query.region) where.region = query.region;
    if (query.flagName) where.flagName = query.flagName;
    if (query.status) where.status = query.status;
    return this.configRepository.find({ where, order: { flagName: 'ASC', region: 'ASC' } });
  }

  async evaluateForRegion(
    flagName: string,
    region: string,
    globalEnabled: boolean,
  ): Promise<RegionalFlagEvaluationResult> {
    const hierarchy = this.regionResolver.getRegionHierarchy(region);
    const configs = await this.configRepository.find({
      where: { flagName, region: In(hierarchy) },
    });
    return this.flagEvaluator.evaluate(flagName, region, configs, globalEnabled);
  }

  async evaluateBulkForRegion(
    flagNames: string[],
    region: string,
    globalFlags: Record<string, boolean>,
  ): Promise<RegionalFlagEvaluationResult[]> {
    const hierarchy = this.regionResolver.getRegionHierarchy(region);
    const configs = await this.configRepository.find({
      where: { flagName: In(flagNames), region: In(hierarchy) },
    });
    return this.flagEvaluator.evaluateBulk(flagNames, region, configs, globalFlags);
  }

  async enableForRegion(flagName: string, region: string, updatedBy: string): Promise<RegionalFlagConfig> {
    return this.update(flagName, region, { enabled: true, status: RegionFlagStatus.ACTIVE }, updatedBy);
  }

  async disableForRegion(flagName: string, region: string, updatedBy: string): Promise<RegionalFlagConfig> {
    return this.update(flagName, region, { enabled: false, status: RegionFlagStatus.INACTIVE }, updatedBy);
  }
}
