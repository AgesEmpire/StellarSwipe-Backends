import { Injectable } from '@nestjs/common';

export interface ConversionEvent {
  campaignId: string;
  userId: string;
  eventType: 'click' | 'impression' | 'conversion';
  value?: number;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

@Injectable()
export class ConversionTracker {
  private readonly events: ConversionEvent[] = [];

  track(event: ConversionEvent): void {
    this.events.push(event);
  }

  getEventsForCampaign(campaignId: string): ConversionEvent[] {
    return this.events.filter((e) => e.campaignId === campaignId);
  }

  computeMetrics(campaignId: string): {
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
    ctr: number;
    conversionRate: number;
  } {
    const events = this.getEventsForCampaign(campaignId);
    const impressions = events.filter((e) => e.eventType === 'impression').length;
    const clicks = events.filter((e) => e.eventType === 'click').length;
    const conversionEvents = events.filter((e) => e.eventType === 'conversion');
    const conversions = conversionEvents.length;
    const revenue = conversionEvents.reduce((sum, e) => sum + (e.value ?? 0), 0);

    return {
      impressions,
      clicks,
      conversions,
      revenue,
      ctr: impressions > 0 ? clicks / impressions : 0,
      conversionRate: clicks > 0 ? conversions / clicks : 0,
    };
  }
}
