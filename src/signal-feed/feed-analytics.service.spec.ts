import { Test, TestingModule } from '@nestjs/testing';
import { FeedAnalyticsService } from './feed-analytics.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { FeedInteractionDto, FeedInteractionType } from './dto/feed-interaction.dto';
import { UserEventType } from '../analytics/entities/user-event.entity';

const mockAnalyticsService = { trackEvent: jest.fn() };

describe('FeedAnalyticsService', () => {
  let service: FeedAnalyticsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedAnalyticsService,
        { provide: AnalyticsService, useValue: mockAnalyticsService },
      ],
    }).compile();
    service = module.get(FeedAnalyticsService);
  });

  it.each<[FeedInteractionType, UserEventType]>([
    [FeedInteractionType.SWIPE_IMPRESSION, UserEventType.SIGNAL_VIEW],
    [FeedInteractionType.SWIPE_RIGHT, UserEventType.SWIPE_RIGHT],
    [FeedInteractionType.SWIPE_LEFT, UserEventType.SWIPE_LEFT],
    [FeedInteractionType.CARD_DETAIL_OPEN, UserEventType.SIGNAL_VIEW],
    [FeedInteractionType.FEED_VIEW, UserEventType.SIGNAL_VIEW],
  ])('maps %s → %s and calls trackEvent', async (interactionType, expectedEventType) => {
    mockAnalyticsService.trackEvent.mockResolvedValue({ status: 'tracked' });

    const dto: FeedInteractionDto = {
      type: interactionType,
      signalId: 'sig-1',
      providerId: 'prov-1',
      device: 'ios',
      cohort: 'fast_converters',
      feedContext: 'sort:recent',
      eventId: 'evt-abc',
    };

    const result = await service.track(dto, 'user-1', 'sess-1');

    expect(result.status).toBe('tracked');
    expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: expectedEventType,
        userId: 'user-1',
        sessionId: 'sess-1',
        eventId: 'evt-abc',
        metadata: expect.objectContaining({
          interactionType,
          signalId: 'sig-1',
          providerId: 'prov-1',
          device: 'ios',
          cohort: 'fast_converters',
          feedContext: 'sort:recent',
        }),
      }),
    );
  });

  it('returns duplicate status when analytics service reports duplicate', async () => {
    mockAnalyticsService.trackEvent.mockResolvedValue({ status: 'duplicate' });
    const dto: FeedInteractionDto = { type: FeedInteractionType.SWIPE_RIGHT, eventId: 'dup-1' };
    const result = await service.track(dto);
    expect(result.status).toBe('duplicate');
  });

  it('works without userId or sessionId (anonymous events)', async () => {
    mockAnalyticsService.trackEvent.mockResolvedValue({ status: 'tracked' });
    const dto: FeedInteractionDto = { type: FeedInteractionType.FEED_VIEW };
    const result = await service.track(dto);
    expect(result.status).toBe('tracked');
    expect(mockAnalyticsService.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: undefined, sessionId: undefined }),
    );
  });
});
