import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DataRegion, RegionCode, RegionStatus } from '../entities/data-region.entity';
import { RegionDetector } from '../utils/region-detector';
import { EuStorageStrategy } from '../strategies/eu-storage.strategy';
import { UsStorageStrategy } from '../strategies/us-storage.strategy';
import { AsiaStorageStrategy } from '../strategies/asia-storage.strategy';

export interface RoutingDecision {
  userId: string;
  assignedRegion: RegionCode;
  storageEndpoint: string;
  rationale: string;
}

@Injectable()
export class RegionRouterService {
  private readonly logger = new Logger(RegionRouterService.name);

  constructor(
    @InjectRepository(DataRegion)
    private readonly regionRepo: Repository<DataRegion>,
    private readonly regionDetector: RegionDetector,
    private readonly euStrategy: EuStorageStrategy,
    private readonly usStrategy: UsStorageStrategy,
    private readonly asiaStrategy: AsiaStorageStrategy,
  ) {}

  async routeUser(
    userId: string,
    countryCode?: string,
    timezone?: string,
    preferredRegion?: RegionCode,
  ): Promise<RoutingDecision> {
    let assignedRegion: RegionCode;
    let rationale: string;

    if (preferredRegion && this.regionDetector.isRegionValid(preferredRegion)) {
      assignedRegion = preferredRegion;
      rationale = 'user_preference';
    } else if (countryCode) {
      assignedRegion = this.regionDetector.detectRegionByCountry(countryCode);
      rationale = `country_mapping:${countryCode}`;
    } else if (timezone) {
      assignedRegion = this.regionDetector.detectRegionByTimezone(timezone);
      rationale = `timezone_mapping:${timezone}`;
    } else {
      assignedRegion = RegionCode.US;
      rationale = 'default_fallback';
    }

    const activeRegion = await this.getActiveRegion(assignedRegion);
    if (!activeRegion) {
      this.logger.warn(`Region ${assignedRegion} is not active, falling back to US`);
      assignedRegion = RegionCode.US;
      rationale = `fallback_from_inactive:${assignedRegion}`;
    }

    const storageEndpoint = this.getStorageEndpoint(assignedRegion);

    this.logger.debug(
      `Routed user ${userId} to region ${assignedRegion} (${rationale})`,
    );

    return { userId, assignedRegion, storageEndpoint, rationale };
  }

  async getActiveRegion(regionCode: RegionCode): Promise<DataRegion | null> {
    return this.regionRepo.findOne({
      where: { code: regionCode, status: RegionStatus.ACTIVE },
    });
  }

  async getAllActiveRegions(): Promise<DataRegion[]> {
    return this.regionRepo.find({ where: { status: RegionStatus.ACTIVE } });
  }

  getStorageEndpoint(region: RegionCode): string {
    switch (region) {
      case RegionCode.EU:
        return this.euStrategy.getStorageEndpoint();
      case RegionCode.US:
        return this.usStrategy.getStorageEndpoint();
      case RegionCode.ASIA:
      case RegionCode.APAC:
        return this.asiaStrategy.getStorageEndpoint();
      default:
        return this.usStrategy.getStorageEndpoint();
    }
  }

  async findRegionByCode(code: RegionCode): Promise<DataRegion> {
    const region = await this.regionRepo.findOne({ where: { code } });
    if (!region) {
      throw new NotFoundException(`Region ${code} not found`);
    }
    return region;
  }
}
