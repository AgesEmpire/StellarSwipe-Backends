import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DriftDetectorService, FeedSample } from './drift-detector.service';
import { DriftFinding } from './entities/drift-finding.entity';

const mockDriftFindingRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
});

const mockEventEmitter = () => ({
  emit: jest.fn(),
});

describe('DriftDetectorService', () => {
  let service: DriftDetectorService;
  let driftFindingRepo: ReturnType<typeof mockDriftFindingRepo>;
  let eventEmitter: ReturnType<typeof mockEventEmitter>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DriftDetectorService,
        { provide: getRepositoryToken(DriftFinding), useFactory: mockDriftFindingRepo },
        { provide: EventEmitter2, useFactory: mockEventEmitter },
      ],
    }).compile();

    service = module.get(DriftDetectorService);
    driftFindingRepo = module.get(getRepositoryToken(DriftFinding));
    eventEmitter = module.get(EventEmitter2);
  });

  describe('detectDrift', () => {
    it('returns stable result when distributions are identical', async () => {
      const baseline = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
      const current = [10, 10, 10, 10, 10];

      const samples: FeedSample[] = [
        { feedKey: 'test_feed', baselineValues: baseline, currentValues: current },
      ];

      const results = await service.detectDrift(samples);

      expect(results).toHaveLength(1);
      expect(results[0].feedKey).toBe('test_feed');
      expect(results[0].isDrift).toBe(false);
      expect(results[0].severity).toBe('stable');
      expect(driftFindingRepo.save).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('detects minor drift and persists finding', async () => {
      // Baseline centred around 10, current shifted to ~15 — moderate drift
      const baseline = [8, 9, 10, 11, 12, 9, 10, 11, 10, 9, 10, 11, 10, 9, 8];
      const current = [14, 15, 16, 15, 14, 15, 16, 15, 14, 15];

      const finding = { id: 'uuid-1' };
      driftFindingRepo.create.mockReturnValue(finding);
      driftFindingRepo.save.mockResolvedValue(finding);

      const samples: FeedSample[] = [
        { feedKey: 'price_feed', baselineValues: baseline, currentValues: current },
      ];

      const results = await service.detectDrift(samples);

      expect(results).toHaveLength(1);
      expect(results[0].isDrift).toBe(true);
      expect(['minor', 'significant']).toContain(results[0].severity);
      expect(driftFindingRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ feedKey: 'price_feed' }),
      );
      expect(driftFindingRepo.save).toHaveBeenCalledWith(finding);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'analytics.drift.detected',
        expect.objectContaining({ feedKey: 'price_feed' }),
      );
    });

    it('detects significant drift for heavily shifted distribution', async () => {
      // Baseline: values around 1–5; current: values around 50–100
      const baseline = Array.from({ length: 20 }, (_, i) => (i % 5) + 1);
      const current = Array.from({ length: 10 }, (_, i) => 50 + i * 5);

      const finding = { id: 'uuid-2' };
      driftFindingRepo.create.mockReturnValue(finding);
      driftFindingRepo.save.mockResolvedValue(finding);

      const samples: FeedSample[] = [
        { feedKey: 'volume_feed', baselineValues: baseline, currentValues: current },
      ];

      const results = await service.detectDrift(samples);

      expect(results[0].severity).toBe('significant');
      expect(results[0].isDrift).toBe(true);
    });

    it('handles multiple feeds and returns a result per feed', async () => {
      const stableSample: FeedSample = {
        feedKey: 'stable_feed',
        baselineValues: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
        currentValues: [5, 5, 5, 5, 5],
      };
      const driftSample: FeedSample = {
        feedKey: 'drifted_feed',
        baselineValues: [1, 2, 1, 2, 1, 2, 1, 2, 1, 2],
        currentValues: [90, 95, 92, 88, 91],
      };

      driftFindingRepo.create.mockReturnValue({});
      driftFindingRepo.save.mockResolvedValue({});

      const results = await service.detectDrift([stableSample, driftSample]);

      expect(results).toHaveLength(2);
      const stable = results.find((r) => r.feedKey === 'stable_feed');
      const drifted = results.find((r) => r.feedKey === 'drifted_feed');
      expect(stable?.isDrift).toBe(false);
      expect(drifted?.isDrift).toBe(true);
    });

    it('does not throw when persistence fails — logs error and continues', async () => {
      const baseline = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2];
      const current = [90, 95, 92, 88, 91];

      driftFindingRepo.create.mockReturnValue({});
      driftFindingRepo.save.mockRejectedValue(new Error('DB error'));

      const samples: FeedSample[] = [
        { feedKey: 'error_feed', baselineValues: baseline, currentValues: current },
      ];

      await expect(service.detectDrift(samples)).resolves.not.toThrow();
    });

    it('returns empty results for empty samples array', async () => {
      const results = await service.detectDrift([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('getFindings', () => {
    it('returns findings from repository', async () => {
      const mockFindings = [{ id: 'f1', feedKey: 'price_feed', severity: 'minor' }];
      driftFindingRepo.find.mockResolvedValue(mockFindings);

      const result = await service.getFindings({ feedKey: 'price_feed', limit: 10 });

      expect(driftFindingRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ feedKey: 'price_feed' }),
          take: 10,
        }),
      );
      expect(result).toBe(mockFindings);
    });

    it('applies since filter when provided', async () => {
      driftFindingRepo.find.mockResolvedValue([]);
      const since = new Date('2024-01-01');

      await service.getFindings({ since });

      expect(driftFindingRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ detectedAt: expect.anything() }),
        }),
      );
    });

    it('uses default limit of 100 when not specified', async () => {
      driftFindingRepo.find.mockResolvedValue([]);

      await service.getFindings();

      expect(driftFindingRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });
});
