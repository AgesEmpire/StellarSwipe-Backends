import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { Campaign, CampaignStatus } from '../entities/campaign.entity';

@Injectable()
export class ExecuteCampaignsJob {
  private readonly logger = new Logger(ExecuteCampaignsJob.name);

  constructor(
    @InjectRepository(Campaign)
    private campaignRepository: Repository<Campaign>,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async activateScheduledCampaigns(): Promise<void> {
    const now = new Date();
    const campaigns = await this.campaignRepository.find({
      where: {
        status: CampaignStatus.DRAFT,
        startDate: LessThanOrEqual(now),
        endDate: MoreThanOrEqual(now),
      },
    });

    for (const campaign of campaigns) {
      campaign.status = CampaignStatus.ACTIVE;
      await this.campaignRepository.save(campaign);
      this.logger.log(`Activated campaign ${campaign.id} (${campaign.name}) for region ${campaign.region}`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async completePastCampaigns(): Promise<void> {
    const now = new Date();
    const campaigns = await this.campaignRepository.find({
      where: {
        status: CampaignStatus.ACTIVE,
        endDate: LessThanOrEqual(now),
      },
    });

    for (const campaign of campaigns) {
      campaign.status = CampaignStatus.COMPLETED;
      await this.campaignRepository.save(campaign);
      this.logger.log(`Completed campaign ${campaign.id} (${campaign.name})`);
    }
  }
}
