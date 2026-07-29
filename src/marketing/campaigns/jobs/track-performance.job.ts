import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Campaign, CampaignStatus } from '../entities/campaign.entity';
import { PerformanceTrackerService } from '../services/performance-tracker.service';

@Injectable()
export class TrackPerformanceJob {
  private readonly logger = new Logger(TrackPerformanceJob.name);

  constructor(
    @InjectRepository(Campaign)
    private campaignRepository: Repository<Campaign>,
    private performanceTracker: PerformanceTrackerService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async snapshotDailyPerformance(): Promise<void> {
    const activeCampaigns = await this.campaignRepository.find({
      where: { status: CampaignStatus.ACTIVE },
    });

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    for (const campaign of activeCampaigns) {
      try {
        await this.performanceTracker.recordDailyMetrics(campaign.id, yesterday, {});
        this.logger.debug(`Snapshotted performance for campaign ${campaign.id}`);
      } catch (err) {
        this.logger.error(`Failed to snapshot performance for campaign ${campaign.id}`, err);
      }
    }
  }
}
