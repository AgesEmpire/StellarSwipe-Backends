import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BehaviorTrackingService } from './behavior-tracking.service';
import { UserSessionAnalytics } from './entities/user-session.entity';
import { UserEvent, UserEventType } from './entities/user-event.entity';
import { AnalyticsService } from './analytics.service';

const mockSessionRepo = () => ({
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockEventRepo = () => ({
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockAnalyticsService = () => ({
  trackEvent: jest.fn(),
});

describe('BehaviorTrackingService', () => {
  let service: BehaviorTrackingService;
  let sessionRepo: ReturnType<typeof mockSessionRepo>;
  let analyticsService: ReturnType<typeof mockAnalyticsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BehaviorTrackingService,
        { provide: getRepositoryToken(UserSessionAnalytics), useFactory: mockSessionRepo },
        { provide: getRepositoryToken(UserEvent), useFactory: mockEventRepo },
        { provide: AnalyticsService, useFactory: mockAnalyticsService },
      ],
    }).compile();

    service = module.get(BehaviorTrackingService);
    sessionRepo = module.get(getRepositoryToken(UserSessionAnalytics));
    analyticsService = module.get(AnalyticsService);
  });

  describe('startSession', () => {
    it('returns existing session if already started', async () => {
      const existing = { sessionId: 'sess-1', startedAt: new Date() };
      sessionRepo.findOne.mockResolvedValue(existing);

      const result = await service.startSession('sess-1', 'user-1');
      expect(result).toBe(existing);
      expect(sessionRepo.create).not.toHaveBeenCalled();
    });

    it('creates a new session when none exists', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      const created = { sessionId: 'sess-2', startedAt: new Date(), eventCount: 0 };
      sessionRepo.create.mockReturnValue(created);
      sessionRepo.save.mockResolvedValue(created);

      const result = await service.startSession('sess-2', 'user-1');
      expect(sessionRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'sess-2', userId: 'user-1', eventCount: 0 }),
      );
      expect(result).toBe(created);
    });
  });

  describe('endSession', () => {
    it('returns null when session not found', async () => {
      sessionRepo.findOne.mockResolvedValue(null);
      const result = await service.endSession('missing');
      expect(result).toBeNull();
    });

    it('calculates duration and event count on end', async () => {
      const startedAt = new Date(Date.now() - 60_000);
      const session = { sessionId: 'sess-3', startedAt, endedAt: undefined, eventCount: 0 };
      sessionRepo.findOne.mockResolvedValue(session);
      sessionRepo.save.mockImplementation((s) => Promise.resolve(s));

      // Mock event repo count
      const eventRepo = service['eventRepo'] as any;
      eventRepo.count = jest.fn().mockResolvedValue(5);

      const result = await service.endSession('sess-3');
      expect(result?.durationSeconds).toBeGreaterThanOrEqual(59);
      expect(result?.eventCount).toBe(5);
      expect(result?.endedAt).toBeDefined();
    });
  });

  describe('trackEvent', () => {
    it('delegates to analyticsService and returns status', async () => {
      analyticsService.trackEvent.mockResolvedValue({ status: 'tracked' });
      const qb = { update: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), execute: jest.fn().mockResolvedValue({}) };
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.trackEvent(
        UserEventType.SIGNAL_VIEW,
        new Date(),
        'user-1',
        'sess-1',
      );
      expect(result.status).toBe('tracked');
      expect(analyticsService.trackEvent).toHaveBeenCalled();
    });

    it('skips session increment on duplicate event', async () => {
      analyticsService.trackEvent.mockResolvedValue({ status: 'duplicate' });

      const result = await service.trackEvent(UserEventType.SWIPE_RIGHT, new Date());
      expect(result.status).toBe('duplicate');
      expect(sessionRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('getSessionMetrics', () => {
    it('returns zero metrics when no sessions', async () => {
      const qb = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([]) };
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getSessionMetrics(new Date(), new Date());
      expect(result.totalSessions).toBe(0);
      expect(result.avgDurationSeconds).toBe(0);
    });

    it('calculates bounce rate correctly', async () => {
      const sessions = [
        { durationSeconds: 120, eventCount: 1 }, // bounce
        { durationSeconds: 300, eventCount: 5 },
        { durationSeconds: 60, eventCount: 1 },  // bounce
      ];
      const qb = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue(sessions) };
      sessionRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getSessionMetrics(new Date(), new Date());
      expect(result.totalSessions).toBe(3);
      expect(result.bounceRate).toBeCloseTo(66.67, 1);
    });
  });
});
