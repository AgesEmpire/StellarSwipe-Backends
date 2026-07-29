import { Injectable } from '@nestjs/common';
import { AnalyticsService } from '../analytics/analytics.service';
import { UserEventType } from '../analytics/entities/user-event.entity';
import { FeedInteractionDto, FeedInteractionType } from './dto/feed-interaction.dto';

const INTERACTION_TO_EVENT: Partial<Record<FeedInteractionType, UserEventType>> = {
  [FeedInteractionType.SWIPE_IMPRESSION]: UserEventType.SIGNAL_VIEW,
  [FeedInteractionType.SWIPE_RIGHT]: UserEventType.SWIPE_RIGHT,
  [FeedInteractionType.SWIPE_LEFT]: UserEventType.SWIPE_LEFT,
  [FeedInteractionType.CARD_DETAIL_OPEN]: UserEventType.SIGNAL_VIEW,
  [FeedInteractionType.FEED_VIEW]: UserEventType.SIGNAL_VIEW,
};

@Injectable()
export class FeedAnalyticsService {
  constructor(private readonly analyticsService: AnalyticsService) {}

  async track(
    dto: FeedInteractionDto,
    userId?: string,
    sessionId?: string,
  ): Promise<{ status: 'tracked' | 'duplicate' | 'skipped' }> {
    const eventType = INTERACTION_TO_EVENT[dto.type];
    if (!eventType) return { status: 'skipped' };

    return this.analyticsService.trackEvent({
      eventType,
      occurredAt: new Date(),
      userId,
      sessionId,
      eventId: dto.eventId,
      metadata: {
        interactionType: dto.type,
        signalId: dto.signalId,
        providerId: dto.providerId,
        device: dto.device,
        cohort: dto.cohort,
        feedContext: dto.feedContext,
      },
    });
  }
}
