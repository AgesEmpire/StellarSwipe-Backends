import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ReputationScore } from './reputation-score.entity';
import { ReputationScoringService } from './reputation-scoring.service';
import { ProviderReputationService, SignalOutcomeEvent } from './provider-reputation.service';

const makeRecord = (overrides: Partial<ReputationScore> = {}): ReputationScore =>
  ({
    id: 'rep-1',
    providerId: 'prov-1',
    score: 50,
    winRate: 0.5,
    consistencyScore: 30,
    retentionRate: 0.4,
    stakeBonus: 5,
    avgRating: 4,
    totalSignals: 10,
    winningSignals: 7,
    totalCopiers: 50,
    activeCopiers: 20,
    stakeAmount: 5000,
    isBlacklisted: false,
    invalidatedCount: 0,
    ...overrides,
  } as any);

const successEvent: SignalOutcomeEvent = {
  providerId: 'prov-1',
  signalId: 'sig-1',
  outcome: 'success',
  returnPct: 15,
  copierCount: 30,
};

describe('ProviderReputationService', () => {
  let service: ProviderReputationService;
  let reputationRepo: any;
  let scoringService: any;

  beforeEach(async () => {
    reputationRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    scoringService = {
      calculateScore: jest.fn().mockReturnValue({
        score: 65,
        smoothedScore: 62,
        winRate: 0.7,
        consistencyScore: 35,
        retentionRate: 0.5,
        stakeBonus: 5,
        avgRating: 4,
        isNewProvider: false,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderReputationService,
        { provide: getRepositoryToken(ReputationScore), useValue: reputationRepo },
        { provide: ReputationScoringService, useValue: scoringService },
      ],
    }).compile();

    service = module.get(ProviderReputationService);
  });

  describe('applySignalOutcome', () => {
    it('increments totalSignals and winningSignals on success', async () => {
      const record = makeRecord();
      reputationRepo.findOne.mockResolvedValue(record);
      reputationRepo.save.mockResolvedValue({ ...record, score: 62 });

      const result = await service.applySignalOutcome(successEvent);
      expect(record.totalSignals).toBe(11);
      expect(record.winningSignals).toBe(8);
      expect(result.providerId).toBe('prov-1');
    });

    it('increments totalSignals only on failure', async () => {
      const record = makeRecord();
      reputationRepo.findOne.mockResolvedValue(record);
      reputationRepo.save.mockResolvedValue(record);

      await service.applySignalOutcome({ ...successEvent, outcome: 'failure' });
      expect(record.totalSignals).toBe(11);
      expect(record.winningSignals).toBe(7); // unchanged
    });

    it('rolls back totalSignals on invalidated outcome', async () => {
      const record = makeRecord();
      reputationRepo.findOne.mockResolvedValue(record);
      reputationRepo.save.mockResolvedValue(record);

      await service.applySignalOutcome({ ...successEvent, outcome: 'invalidated' });
      expect(record.totalSignals).toBe(9); // rolled back by 1
      expect((record as any).invalidatedCount).toBe(1);
    });

    it('skips update for blacklisted providers', async () => {
      const record = makeRecord({ isBlacklisted: true } as any);
      reputationRepo.findOne.mockResolvedValue(record);

      const result = await service.applySignalOutcome(successEvent);
      expect(reputationRepo.save).not.toHaveBeenCalled();
      expect(result.isBlacklisted).toBe(true);
      expect(result.delta).toBe(0);
    });

    it('auto-blacklists after 5 invalidations', async () => {
      const record = makeRecord({ invalidatedCount: 4 } as any);
      reputationRepo.findOne.mockResolvedValue(record);
      reputationRepo.save.mockResolvedValue(record);

      await service.applySignalOutcome({ ...successEvent, outcome: 'invalidated' });
      expect((record as any).isBlacklisted).toBe(true);
    });

    it('throws NotFoundException when record does not exist', async () => {
      reputationRepo.findOne.mockResolvedValue(null);
      await expect(service.applySignalOutcome(successEvent)).rejects.toThrow(NotFoundException);
    });
  });

  describe('initReputation', () => {
    it('creates a new record for a new provider', async () => {
      reputationRepo.findOne.mockResolvedValue(null);
      const created = makeRecord({ score: 50, totalSignals: 0 });
      reputationRepo.create.mockReturnValue(created);
      reputationRepo.save.mockResolvedValue(created);

      const result = await service.initReputation('prov-new', 1000);
      expect(reputationRepo.create).toHaveBeenCalled();
      expect(reputationRepo.save).toHaveBeenCalled();
    });

    it('returns existing record without creating a duplicate', async () => {
      const existing = makeRecord();
      reputationRepo.findOne.mockResolvedValue(existing);

      const result = await service.initReputation('prov-1', 1000);
      expect(reputationRepo.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });
  });
});
