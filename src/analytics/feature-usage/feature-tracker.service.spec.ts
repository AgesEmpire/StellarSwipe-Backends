import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { FeatureTrackerService } from './feature-tracker.service';
import {
  FeatureUsageEvent,
  UserSegment,
  UsageEventType,
} from './entities/feature-usage.entity';
import {
  FeatureAdoption,
  AdoptionStage,
} from './entities/feature-adoption.entity';

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const buildEvent = (
  overrides: Partial<FeatureUsageEvent> = {},
): FeatureUsageEvent =>
  ({
    id: 'ev-uuid-1',
    featureKey: 'swap',
    featureCategory: 'trading',
    userId: 'user-001',
    userSegment: UserSegment.PRO,
    eventType: UsageEventType.COMPLETE,
    sessionId: 'sess-1',
    durationMs: 1200,
    metadata: null,
    occurredAt: new Date('2024-03-01T10:00:00Z'),
    createdAt: new Date('2024-03-01T10:00:00Z'),
    ...overrides,
  }) as FeatureUsageEvent;

const buildAdoption = (
  overrides: Partial<FeatureAdoption> = {},
): FeatureAdoption =>
  ({
    id: 'ad-uuid-1',
    featureKey: 'swap',
    featureCategory: 'trading',
    periodDate: '2024-03-01',
    userSegment: null,
    totalEvents: 50,
    uniqueUsers: 20,
    newUsers: 8,
    returningUsers: 12,
    adoptionRate: 0.2,
    retentionRate: 0.6,
    avgDurationMs: 1100,
    errorRate: 0.02,
    stageBreakdown: {
      [AdoptionStage.AWARENESS]: 2,
      [AdoptionStage.ACTIVATION]: 5,
      [AdoptionStage.HABIT]: 8,
      [AdoptionStage.CHAMPION]: 3,
      [AdoptionStage.CHURNED]: 2,
    },
    aggregatedAt: new Date('2024-03-02T01:00:00Z'),
    createdAt: new Date('2024-03-02T01:00:00Z'),
    updatedAt: new Date('2024-03-02T01:00:00Z'),
    ...overrides,
  }) as FeatureAdoption;

describe('FeatureTrackerService', () => {
  let service: FeatureTrackerService;
  let usageRepo: ReturnType<typeof mockRepo>;
  let adoptionRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureTrackerService,
        {
          provide: getRepositoryToken(FeatureUsageEvent),
          useFactory: mockRepo,
        },
        { provide: getRepositoryToken(FeatureAdoption), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get<FeatureTrackerService>(FeatureTrackerService);
    usageRepo = module.get(getRepositoryToken(FeatureUsageEvent));
    adoptionRepo = module.get(getRepositoryToken(FeatureAdoption));
  });

  afterEach(() => jest.clearAllMocks());

  // -------------------------
  // trackEvent
  // -------------------------
  describe('trackEvent', () => {
    it('should create and save a usage event with defaults', async () => {
      const entity = buildEvent();
      usageRepo.create.mockReturnValue(entity);
      usageRepo.save.mockResolvedValue(entity);

      await service.trackEvent({
        featureKey: 'swap',
        userId: 'user-001',
      });

      expect(usageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ featureKey: 'swap', userId: 'user-001' }),
      );
      expect(usageRepo.save).toHaveBeenCalledWith(entity);
    });

    it('should persist custom event type and duration', async () => {
      const entity = buildEvent({
        eventType: UsageEventType.ERROR,
        durationMs: 500,
      });
      usageRepo.create.mockReturnValue(entity);
      usageRepo.save.mockResolvedValue(entity);

      await service.trackEvent({
        featureKey: 'swap',
        userId: 'user-001',
        eventType: UsageEventType.ERROR,
        durationMs: 500,
      });

      expect(usageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: UsageEventType.ERROR,
          durationMs: 500,
        }),
      );
    });
  });

  // -------------------------
  // trackBulk
  // -------------------------
  describe('trackBulk', () => {
    it('should create and save multiple events', async () => {
      usageRepo.create.mockImplementation((data) => data);
      usageRepo.save.mockResolvedValue([]);

      const result = await service.trackBulk({
        events: [
          { featureKey: 'swap', userId: 'user-001' },
          { featureKey: 'pool', userId: 'user-002' },
        ],
      });

      expect(result.tracked).toBe(2);
      expect(usageRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------
  // getFeatureMetrics
  // -------------------------
  describe('getFeatureMetrics', () => {
    it('should return zero metrics when no events exist', async () => {
      usageRepo.find.mockResolvedValue([]);
      const qb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ count: '0' }),
      };
      usageRepo.createQueryBuilder.mockReturnValue(qb);
      adoptionRepo.findOne.mockResolvedValue(null);
      usageRepo.count.mockResolvedValue(0);

      const result = await service.getFeatureMetrics({
        featureKey: 'unknown-feature',
      });

      expect(result.featureKey).toBe('unknown-feature');
      expect(result.totalEvents).toBe(0);
      expect(result.uniqueUsers).toBe(0);
    });

    it('should compute correct adoption and error rates from events', async () => {
      const events = [
        buildEvent({ userId: 'u1', eventType: UsageEventType.COMPLETE }),
        buildEvent({ userId: 'u2', eventType: UsageEventType.ERROR }),
        buildEvent({ userId: 'u3', eventType: UsageEventType.COMPLETE }),
      ];
      usageRepo.find.mockResolvedValue(events);

      const qb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ count: '10' }),
      };
      usageRepo.createQueryBuilder.mockReturnValue(qb);
      adoptionRepo.findOne.mockResolvedValue(buildAdoption());
      usageRepo.count.mockResolvedValue(3);

      const result = await service.getFeatureMetrics({ featureKey: 'swap' });

      expect(result.totalEvents).toBe(3);
      expect(result.uniqueUsers).toBe(3);
      expect(result.errorRate).toBeCloseTo(1 / 3, 2);
    });
  });

  // -------------------------
  // getUserFeatureUsage
  // -------------------------
  describe('getUserFeatureUsage', () => {
    it('should return empty profile when user has no events', async () => {
      usageRepo.find.mockResolvedValue([]);
      const result = await service.getUserFeatureUsage({
        userId: 'ghost-user',
      });

      expect(result.userId).toBe('ghost-user');
      expect(result.totalEvents).toBe(0);
      expect(result.featuresUsed).toBe(0);
      expect(result.firstSeenAt).toBeNull();
    });

    it('should aggregate top features and adoption stages correctly', async () => {
      const events = [
        buildEvent({ featureKey: 'swap', userId: 'u1' }),
        buildEvent({ featureKey: 'swap', userId: 'u1' }),
        buildEvent({ featureKey: 'pool', userId: 'u1' }),
      ];
      usageRepo.find.mockResolvedValue(events);

      const result = await service.getUserFeatureUsage({ userId: 'u1' });

      expect(result.featuresUsed).toBe(2);
      expect(result.totalEvents).toBe(3);
      expect(result.topFeatures[0].featureKey).toBe('swap');
      expect(result.topFeatures[0].eventCount).toBe(2);
      expect(result.adoptionStages['swap']).toBeDefined();
    });
  });

  // -------------------------
  // aggregateDailyAdoption
  // -------------------------
  describe('aggregateDailyAdoption', () => {
    it('should return zero upserted when no events exist for the day', async () => {
      usageRepo.find.mockResolvedValue([]);
      const result = await service.aggregateDailyAdoption(
        new Date('2024-03-01'),
      );
      expect(result.upserted).toBe(0);
    });

    it('should upsert one record per unique feature key', async () => {
      const events = [
        buildEvent({ featureKey: 'swap', userId: 'u1' }),
        buildEvent({ featureKey: 'swap', userId: 'u2' }),
        buildEvent({ featureKey: 'pool', userId: 'u1' }),
      ];
      // First find = today's events; second find = prev day's events
      usageRepo.find.mockResolvedValueOnce(events).mockResolvedValueOnce([]);

      const qb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ count: '10' }),
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orUpdate: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({}),
      };
      usageRepo.createQueryBuilder.mockReturnValue(qb);
      adoptionRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.aggregateDailyAdoption(
        new Date('2024-03-01'),
      );
      expect(result.upserted).toBe(2); // swap + pool
    });
  });

  // -------------------------
  // getAdoptionCurve
  // -------------------------
  describe('getAdoptionCurve', () => {
    it('should build an adoption curve from stored adoption records', async () => {
      adoptionRepo.find.mockResolvedValue([
        buildAdoption({ periodDate: '2024-03-01', adoptionRate: 0.15 }),
        buildAdoption({ periodDate: '2024-03-02', adoptionRate: 0.2 }),
        buildAdoption({ periodDate: '2024-03-03', adoptionRate: 0.25 }),
      ]);

      const result = await service.getAdoptionCurve({ featureKey: 'swap' });

      expect(result.featureKey).toBe('swap');
      expect(result.dataPoints).toHaveLength(3);
      expect(result.peakAdoptionRate).toBe(0.25);
      expect(result.currentAdoptionRate).toBe(0.25);
    });

    it('should return an empty curve when no adoption records exist', async () => {
      adoptionRepo.find.mockResolvedValue([]);
      const result = await service.getAdoptionCurve({
        featureKey: 'new-feature',
      });

      expect(result.dataPoints).toHaveLength(0);
      expect(result.peakAdoptionRate).toBe(0);
      expect(result.currentAdoptionRate).toBe(0);
    });
  });
});
