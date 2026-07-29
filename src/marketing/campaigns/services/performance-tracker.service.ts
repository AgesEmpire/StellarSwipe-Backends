import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { CampaignPerformance } from '../entities/campaign-performance.entity';
import { CampaignMetricsSummary } from '../dto/campaign-metrics.dto';

@Injectable()
export class PerformanceTrackerService {
  constructor(
    @InjectRepository(CampaignPerformance)
    private performanceRepository: Repository<CampaignPerformance>,
  ) {}

  async recordDailyMetrics(
    campaignId: string,
    date: Date,
    metrics: Partial<CampaignPerformance>,
  ): Promise<CampaignPerformance> {
    const existing = await this.performanceRepository.findOne({
      where: { campaignId, date },
    });

    if (existing) {
      const clicks = (existing.clicks ?? 0) + (metrics.clicks ?? 0);
      const impressions = (existing.impressions ?? 0) + (metrics.impressions ?? 0);
      const conversions = (existing.conversions ?? 0) + (metrics.conversions ?? 0);

      Object.assign(existing, {
        ...metrics,
        clicks,
        impressions,
        conversions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        conversionRate: clicks > 0 ? conversions / clicks : 0,
      });
      return this.performanceRepository.save(existing);
    }

    const clicks = metrics.clicks ?? 0;
    const impressions = metrics.impressions ?? 0;
    const conversions = metrics.conversions ?? 0;
    const record = this.performanceRepository.create({
      campaignId,
      date,
      ...metrics,
      ctr: impressions > 0 ? clicks / impressions : 0,
      conversionRate: clicks > 0 ? conversions / clicks : 0,
    });
    return this.performanceRepository.save(record);
  }

  async getSummary(campaignId: string, from?: Date, to?: Date): Promise<CampaignMetricsSummary> {
    const where: any = { campaignId };
    if (from && to) where.date = Between(from, to);

    const records = await this.performanceRepository.find({ where });

    const totalImpressions = records.reduce((s, r) => s + r.impressions, 0);
    const totalClicks = records.reduce((s, r) => s + r.clicks, 0);
    const totalConversions = records.reduce((s, r) => s + r.conversions, 0);
    const totalRevenue = records.reduce((s, r) => s + Number(r.revenue), 0);
    const totalSpend = records.reduce((s, r) => s + Number(r.spend), 0);

    return {
      campaignId,
      totalImpressions,
      totalClicks,
      totalConversions,
      totalRevenue,
      totalSpend,
      averageCtr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
      averageConversionRate: totalClicks > 0 ? totalConversions / totalClicks : 0,
      roi: totalSpend > 0 ? (totalRevenue - totalSpend) / totalSpend : 0,
    };
  }

  async getTimeSeries(campaignId: string, from: Date, to: Date): Promise<CampaignPerformance[]> {
    return this.performanceRepository.find({
      where: { campaignId, date: Between(from, to) },
      order: { date: 'ASC' },
    });
  }
}
