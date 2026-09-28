import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign, CampaignStatus } from './entities/campaign.entity';
import { CampaignTarget } from './entities/campaign-target.entity';
import { CreateCampaignDto, UpdateCampaignDto, CampaignQueryDto } from './dto/create-campaign.dto';
import { CreateCampaignTargetDto } from './dto/campaign-target.dto';
import { CampaignMetricsQueryDto, CampaignMetricsSummary } from './dto/campaign-metrics.dto';
import { PerformanceTrackerService } from './services/performance-tracker.service';

@Injectable()
export class CampaignManagerService {
  constructor(
    @InjectRepository(Campaign)
    private campaignRepository: Repository<Campaign>,
    @InjectRepository(CampaignTarget)
    private targetRepository: Repository<CampaignTarget>,
    private performanceTracker: PerformanceTrackerService,
  ) {}

  async create(dto: CreateCampaignDto, createdBy: string): Promise<Campaign> {
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    if (end <= start) {
      throw new BadRequestException('endDate must be after startDate');
    }

    const campaign = this.campaignRepository.create({
      ...dto,
      startDate: start,
      endDate: end,
      createdBy,
    });
    return this.campaignRepository.save(campaign);
  }

  async findAll(query: CampaignQueryDto): Promise<Campaign[]> {
    const where: Partial<Campaign> = {};
    if (query.region) where.region = query.region;
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    return this.campaignRepository.find({
      where,
      relations: ['targets'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Campaign> {
    const campaign = await this.campaignRepository.findOne({
      where: { id },
      relations: ['targets', 'performance'],
    });
    if (!campaign) throw new NotFoundException(`Campaign ${id} not found`);
    return campaign;
  }

  async update(id: string, dto: UpdateCampaignDto): Promise<Campaign> {
    const campaign = await this.findOne(id);
    Object.assign(campaign, {
      ...dto,
      startDate: dto.startDate ? new Date(dto.startDate) : campaign.startDate,
      endDate: dto.endDate ? new Date(dto.endDate) : campaign.endDate,
    });
    return this.campaignRepository.save(campaign);
  }

  async delete(id: string): Promise<void> {
    const campaign = await this.findOne(id);
    await this.campaignRepository.remove(campaign);
  }

  async addTarget(campaignId: string, dto: CreateCampaignTargetDto): Promise<CampaignTarget> {
    await this.findOne(campaignId);
    const target = this.targetRepository.create({ ...dto, campaignId });
    return this.targetRepository.save(target);
  }

  async removeTarget(campaignId: string, targetId: string): Promise<void> {
    const result = await this.targetRepository.delete({ id: targetId, campaignId });
    if (result.affected === 0) throw new NotFoundException(`Target ${targetId} not found`);
  }

  async getMetrics(id: string, query: CampaignMetricsQueryDto): Promise<CampaignMetricsSummary> {
    await this.findOne(id);
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    return this.performanceTracker.getSummary(id, from, to);
  }

  async activate(id: string): Promise<Campaign> {
    return this.update(id, { status: CampaignStatus.ACTIVE });
  }

  async pause(id: string): Promise<Campaign> {
    return this.update(id, { status: CampaignStatus.PAUSED });
  }

  async cancel(id: string): Promise<Campaign> {
    return this.update(id, { status: CampaignStatus.CANCELLED });
  }
}
