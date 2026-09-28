import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { Signal, SignalType, SignalStatus, SignalOutcome } from '../entities/signal.entity';
import { SignalPerformance } from '../entities/signal-performance.entity';
import {
  ProviderPerformanceTrackerService,
  SignalOutcomeRecord,
} from './provider-performance-tracker.service';

const makeSignal = (overrides: Partial<Signal> = {}): Signal =>
  ({
    id: 'sig-1',
    providerId: 'prov-1',
    type: SignalType.BUY,
    entryPrice: '0.10',
    targetPrice: '0.15',
    status: SignalStatus.ACTIVE,
    outcome: SignalOutcome.PENDING,
    ...overrides,
  } as any);

const makeSnapshot = (overrides: Partial<any> = {}) => ({
  id: 'snap-1',
  providerId: 'prov-1',
  date: new Date(),
  totalSignals: 10,
  closedSignals: 8,
  successfulSignals: 6,
  expiredSignals: 1,
  totalCopiers: 50,
  averageHoldTimeSeconds: 7200,
  avgReturnPct: 12,
  ...overrides,
});

const outcomeRecord: SignalOutcomeRecord = {
  signalId: 'sig-1',
  providerId: 'prov-1',
  outcome: SignalOutcome.TARGET_HIT,
  exitPrice: 0.15,
  copierCount: 30,
};

describe('ProviderPerformanceTrackerService', () => {
  let service: ProviderPerformanceTrackerService;
  let signalRepo: any;
  let performanceRepo: any;

  beforeEach(async () => {
    signalRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };
    performanceRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn(),
      create: jest.fn().mockReturnValue({}),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderPerformanceTrackerService,
        { provide: getRepositoryToken(Signal), useValue: signalRepo },
        { provide: getRepositoryToken(SignalPerformance), useValue: performanceRepo },
      ],
    }).compile();

    service = module.get(ProviderPerformanceTrackerService);
  });

  describe('computeReturnPct', () => {
    it('computes BUY return correctly', () => {
      const signal = makeSignal({ type: SignalType.BUY, entryPrice: '0.10' });
      expect(service.computeReturnPct(signal, 0.15)).toBeCloseTo(50, 2);
    });

    it('computes SELL return correctly', () => {
      const signal = makeSignal({ type: SignalType.SELL, entryPrice: '0.15' });
      expect(service.computeReturnPct(signal, 0.10)).toBeCloseTo(33.33, 1);
    });

    it('returns 0 when entryPrice is 0', () => {
      const signal = makeSignal({ entryPrice: '0' });
      expect(service.computeReturnPct(signal, 0.15)).toBe(0);
    });

    it('returns negative for losing BUY trade', () => {
      const signal = makeSignal({ type: SignalType.BUY, entryPrice: '0.15' });
      expect(service.computeReturnPct(signal, 0.10)).toBeCloseTo(-33.33, 1);
    });
  });

  describe('recordSignalOutcome', () => {
    it('closes signal and records outcome on TARGET_HIT', async () => {
      const signal = makeSignal();
      signalRepo.findOne.mockResolvedValue(signal);
      signalRepo.save.mockResolvedValue({ ...signal, outcome: SignalOutcome.TARGET_HIT, status: SignalStatus.CLOSED });

      const result = await service.recordSignalOutcome(outcomeRecord);
      expect(signalRepo.save).toHaveBeenCalled();
      expect(signal.outcome).toBe(SignalOutcome.TARGET_HIT);
      expect(signal.status).toBe(SignalStatus.CLOSED);
    });

    it('throws NotFoundException for unknown signal', async () => {
      signalRepo.findOne.mockResolvedValue(null);
      await expect(service.recordSignalOutcome(outcomeRecord)).rejects.toThrow(NotFoundException);
    });

    it('upserts daily snapshot after recording outcome', async () => {
      signalRepo.findOne.mockResolvedValue(makeSignal());
      signalRepo.save.mockResolvedValue({});

      await service.recordSignalOutcome(outcomeRecord);
      expect(performanceRepo.save).toHaveBeenCalled();
    });

    it('updates existing snapshot when one exists for today', async () => {
      signalRepo.findOne.mockResolvedValue(makeSignal());
      signalRepo.save.mockResolvedValue({});
      const existingSnapshot = makeSnapshot({ successfulSignals: 5 });
      performanceRepo.findOne.mockResolvedValue(existingSnapshot);

      await service.recordSignalOutcome(outcomeRecord);
      expect(existingSnapshot.successfulSignals).toBe(6);
    });
  });

  describe('aggregateProviderPerformance', () => {
    it('returns empty summary when no snapshots exist', async () => {
      performanceRepo.find.mockResolvedValue([]);
      const result = await service.aggregateProviderPerformance(
        'prov-1', new Date('2024-01-01'), new Date('2024-01-31'),
      );
      expect(result.totalSignals).toBe(0);
      expect(result.successRate).toBe(0);
    });

    it('aggregates totals across multiple snapshots', async () => {
      performanceRepo.find.mockResolvedValue([
        makeSnapshot({ successfulSignals: 6, closedSignals: 8, expiredSignals: 1, totalSignals: 10, avgReturnPct: 12 }),
        makeSnapshot({ successfulSignals: 4, closedSignals: 5, expiredSignals: 0, totalSignals: 5, avgReturnPct: 8 }),
      ]);
      const result = await service.aggregateProviderPerformance(
        'prov-1', new Date('2024-01-01'), new Date('2024-01-31'),
      );
      expect(result.successfulSignals).toBe(10);
      expect(result.totalSignals).toBe(15);
      expect(result.avgReturnPct).toBeCloseTo(10, 1);
    });

    it('computes successRate correctly', async () => {
      performanceRepo.find.mockResolvedValue([
        makeSnapshot({ successfulSignals: 8, closedSignals: 10, expiredSignals: 0 }),
      ]);
      const result = await service.aggregateProviderPerformance(
        'prov-1', new Date('2024-01-01'), new Date('2024-01-31'),
      );
      expect(result.successRate).toBeGreaterThan(0);
    });
  });
});
