import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DecayAnalyzerService } from './decay-analyzer.service';
import { SignalDecay, DecayStatus, DecayCurveType } from './entities/signal-decay.entity';
import { NotFoundException } from '@nestjs/common';

const mockSignalDecay = {
  signalId: 'sig-123',
  signalType: 'crypto',
  decayCurveType: DecayCurveType.EXPONENTIAL,
  status: DecayStatus.ACTIVE,
  initialAccuracy: 0.9,
  currentAccuracy: 0.85,
  decayRate: 0.05,
  halfLifeHours: 13.8,
  optimalEntryWindowStart: 0,
  optimalEntryWindowEnd: 4.5,
  recommendedExpiryHours: 12,
  sampleCount: 10,
  rSquared: 0.98,
  curveParameters: { a: 0.9, b: 0.05 },
  performanceByHour: { '0': 0.9, '5': 0.7 },
  analyzedAt: new Date(),
  validUntil: new Date(),
};

describe('DecayAnalyzerService', () => {
  let service: DecayAnalyzerService;
  let repository: Repository<SignalDecay>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DecayAnalyzerService,
        {
          provide: getRepositoryToken(SignalDecay),
          useValue: {
            create: jest.fn().mockImplementation((dto) => dto),
            save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'uuid', ...entity })),
            findOne: jest.fn(),
            find: jest.fn(),
            createQueryBuilder: jest.fn(() => ({
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnThis(),
              distinctOn: jest.fn().mockReturnThis(),
              getMany: jest.fn(),
            })),
          },
        },
      ],
    }).compile();

    service = module.get<DecayAnalyzerService>(DecayAnalyzerService);
    repository = module.get<Repository<SignalDecay>>(getRepositoryToken(SignalDecay));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeDecay', () => {
    it('should analyze and save decay results', async () => {
      const dto = {
        signalId: 'sig-123',
        signalType: 'crypto',
        performanceData: [
          { hoursElapsed: 0, accuracy: 0.9 },
          { hoursElapsed: 5, accuracy: 0.75 },
          { hoursElapsed: 10, accuracy: 0.6 },
          { hoursElapsed: 24, accuracy: 0.4 },
        ],
      };

      const result = await service.analyzeDecay(dto);

      expect(result.signalId).toBe('sig-123');
      expect(result.decayCurveType).toBeDefined();
      expect(result.halfLifeHours).toBeGreaterThan(0);
      expect(result.recommendedExpiryHours).toBeGreaterThan(0);
      expect(repository.save).toHaveBeenCalled();
    });

    it('should use preferred curve type if it fits well', async () => {
      const dto = {
        signalId: 'sig-456',
        signalType: 'crypto',
        performanceData: [
          { hoursElapsed: 0, accuracy: 0.9 },
          { hoursElapsed: 10, accuracy: 0.8 },
          { hoursElapsed: 20, accuracy: 0.7 },
        ],
        preferredCurveType: DecayCurveType.LINEAR,
      };

      const result = await service.analyzeDecay(dto);
      expect(result.decayCurveType).toBe(DecayCurveType.LINEAR);
    });
  });

  describe('getDecayAnalysis', () => {
    it('should return the latest decay analysis', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockSignalDecay as any);

      const result = await service.getDecayAnalysis('sig-123');

      expect(result.signalId).toBe('sig-123');
      expect(result.status).toBe(DecayStatus.ACTIVE);
    });

    it('should throw NotFoundException if no analysis exists', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(null);

      await expect(service.getDecayAnalysis('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getOptimalTiming', () => {
    it('should compute optimal timing from historical snapshots', async () => {
      const snapshots = [
        { ...mockSignalDecay, signalId: 's1' },
        { ...mockSignalDecay, signalId: 's2' },
      ];

      const queryBuilder = repository.createQueryBuilder();
      (queryBuilder.getMany as jest.Mock).mockResolvedValue(snapshots);

      const result = await service.getOptimalTiming({ signalType: 'crypto' });

      expect(result.signalType).toBe('crypto');
      expect(result.optimalWindows.length).toBeGreaterThan(0);
      expect(result.peakPerformanceHour).toBeDefined();
    });
  });

  describe('assessSignalLifespan', () => {
    it('should assess if a live signal should expire', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockSignalDecay as any);

      // Signal is 2 hours old, should be fine
      const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const result = await service.assessSignalLifespan('sig-123', createdAt);

      expect(result.shouldExpire).toBe(false);
      expect(result.remainingLifespanHours).toBeGreaterThan(0);
    });

    it('should recommend expiration if signal is too old', async () => {
      jest.spyOn(repository, 'findOne').mockResolvedValue(mockSignalDecay as any);

      // Signal is 48 hours old, well past recommended expiry (12h)
      const createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const result = await service.assessSignalLifespan('sig-123', createdAt);

      expect(result.shouldExpire).toBe(true);
      expect(result.expiryReason).toContain('recommended lifespan');
    });
  });

  describe('refreshDecayStatuses', () => {
    it('should update statuses of active signals based on projected decay', async () => {
      const oldAnalyzedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const agingSignal = {
        ...mockSignalDecay,
        analyzedAt: oldAnalyzedAt,
        status: DecayStatus.ACTIVE,
        // High decay rate means it should have degraded after 24h
        curveParameters: { a: 0.9, b: 0.5 },
      };

      jest.spyOn(repository, 'find').mockResolvedValue([agingSignal] as any);

      const { updated } = await service.refreshDecayStatuses();

      expect(updated).toBe(1);
      expect(agingSignal.status).toBe(DecayStatus.EXPIRED);
      expect(repository.save).toHaveBeenCalled();
    });
  });
});
