import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContestsService } from './contests.service';
import { Contest, ContestMetric, ContestStatus } from './entities/contest.entity';
import { Signal } from '../signals/entities/signal.entity';

const mockContestRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
});

const mockSignalRepo = () => ({
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('ContestsService - Leaderboard', () => {
  let service: ContestsService;
  let contestRepo: ReturnType<typeof mockContestRepo>;
  let signalRepo: ReturnType<typeof mockSignalRepo>;

  const activeContest: Contest = {
    id: 'contest-1',
    name: 'Test Contest',
    startTime: new Date(Date.now() - 86400_000),
    endTime: new Date(Date.now() + 86400_000),
    metric: ContestMetric.HIGHEST_ROI,
    minSignals: 1,
    prizePool: '1000',
    status: ContestStatus.ACTIVE,
    winners: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContestsService,
        { provide: getRepositoryToken(Contest), useFactory: mockContestRepo },
        { provide: getRepositoryToken(Signal), useFactory: mockSignalRepo },
      ],
    }).compile();

    service = module.get(ContestsService);
    contestRepo = module.get(getRepositoryToken(Contest));
    signalRepo = module.get(getRepositoryToken(Signal));
  });

  describe('getContestLeaderboard', () => {
    it('throws NotFoundException for unknown contest', async () => {
      contestRepo.findOne.mockResolvedValue(null);
      await expect(service.getContestLeaderboard('bad-id')).rejects.toThrow('Contest not found');
    });

    it('returns leaderboard with sorted entries', async () => {
      contestRepo.findOne.mockResolvedValue(activeContest);

      // Mock signals for two providers
      signalRepo.find.mockResolvedValue([
        { providerId: 'provider-a', outcome: 'TARGET_HIT', pnl: '50', amount: '100', createdAt: new Date() },
        { providerId: 'provider-a', outcome: 'TARGET_HIT', pnl: '30', amount: '100', createdAt: new Date() },
        { providerId: 'provider-b', outcome: 'STOP_LOSS_HIT', pnl: '-10', amount: '100', createdAt: new Date() },
      ]);

      const result = await service.getContestLeaderboard('contest-1');
      expect(result.contestId).toBe('contest-1');
      expect(result.entries).toBeDefined();
      expect(Array.isArray(result.entries)).toBe(true);
      // Entries should be sorted by score descending
      if (result.entries.length > 1) {
        const scores = result.entries.map((e) => parseFloat(e.score));
        for (let i = 0; i < scores.length - 1; i++) {
          expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
        }
      }
    });

    it('returns correct contest metadata', async () => {
      contestRepo.findOne.mockResolvedValue(activeContest);
      signalRepo.find.mockResolvedValue([]);

      const result = await service.getContestLeaderboard('contest-1');
      expect(result.contestName).toBe('Test Contest');
      expect(result.metric).toBe(ContestMetric.HIGHEST_ROI);
      expect(result.status).toBe(ContestStatus.ACTIVE);
    });
  });
});
