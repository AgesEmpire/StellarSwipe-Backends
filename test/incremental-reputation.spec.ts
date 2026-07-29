import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  ReputationScoringService,
  ProviderMetrics,
} from '../src/reputation-scoring/reputation-scoring.service';
import { ReputationScore } from '../src/reputation-scoring/reputation-score.entity';

const buildMetrics = (overrides: Partial<ProviderMetrics> = {}): ProviderMetrics => ({
  providerId: 'provider-1',
  totalSignals: 50,
  winningSignals: 35,
  totalCopiers: 100,
  activeCopiers: 80,
  stakeAmount: 5000,
  avgRating: 4.2,
  ratingCount: 20,
  activeDays: 90,
  activeDaysLast30: 25,
  ...overrides,
});

describe('Incremental vs Full Recompute Equivalence', () => {
  let service: ReputationScoringService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReputationScoringService,
        {
          provide: getRepositoryToken(ReputationScore),
          useValue: { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: { createQueryBuilder: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(ReputationScoringService);
  });

  it('incremental update matches full recompute for a success outcome', () => {
    const base = buildMetrics({ totalSignals: 50, winningSignals: 35 });
    const baseBreakdown = service.calculateScore(base);

    const afterFull = service.calculateScore(
      buildMetrics({ totalSignals: 51, winningSignals: 36 }),
    );

    const afterIncremental = service.calculateIncrementalScore(
      {
        score: baseBreakdown.score,
        smoothedScore: baseBreakdown.score,
        totalSignals: 50,
        winningSignals: 35,
        totalCopiers: 100,
        activeCopiers: 80,
        stakeAmount: 5000,
        avgRating: 4.2,
        ratingCount: 20,
        activeDays: 90,
        activeDaysLast30: 25,
      },
      { signalsDelta: 1, winsDelta: 1, newCopierCount: 80 },
    );

    expect(afterIncremental.score).toBe(afterFull.score);
    expect(afterIncremental.winRate).toBe(afterFull.winRate);
    expect(afterIncremental.consistencyScore).toBe(afterFull.consistencyScore);
  });

  it('incremental update matches full recompute for a failure outcome', () => {
    const afterFull = service.calculateScore(
      buildMetrics({ totalSignals: 51, winningSignals: 35 }),
    );

    const baseBreakdown = service.calculateScore(buildMetrics());

    const afterIncremental = service.calculateIncrementalScore(
      {
        score: baseBreakdown.score,
        smoothedScore: baseBreakdown.score,
        totalSignals: 50,
        winningSignals: 35,
        totalCopiers: 100,
        activeCopiers: 80,
        stakeAmount: 5000,
        avgRating: 4.2,
        ratingCount: 20,
        activeDays: 90,
        activeDaysLast30: 25,
      },
      { signalsDelta: 1, winsDelta: 0, newCopierCount: 80 },
    );

    expect(afterIncremental.score).toBe(afterFull.score);
    expect(afterIncremental.winRate).toBe(afterFull.winRate);
  });

  it('incremental update matches full recompute for an invalidated outcome', () => {
    const afterFull = service.calculateScore(
      buildMetrics({ totalSignals: 49, winningSignals: 35 }),
    );

    const baseBreakdown = service.calculateScore(buildMetrics());

    const afterIncremental = service.calculateIncrementalScore(
      {
        score: baseBreakdown.score,
        smoothedScore: baseBreakdown.score,
        totalSignals: 50,
        winningSignals: 35,
        totalCopiers: 100,
        activeCopiers: 80,
        stakeAmount: 5000,
        avgRating: 4.2,
        ratingCount: 20,
        activeDays: 90,
        activeDaysLast30: 25,
      },
      { signalsDelta: -1, winsDelta: 0, newCopierCount: 80 },
    );

    expect(afterIncremental.score).toBe(afterFull.score);
    expect(afterIncremental.winRate).toBe(afterFull.winRate);
  });

  it('produces equivalent scores across a sequence of incremental updates', () => {
    const outcomes: Array<{ signalsDelta: number; winsDelta: number }> = [
      { signalsDelta: 1, winsDelta: 1 },
      { signalsDelta: 1, winsDelta: 0 },
      { signalsDelta: 1, winsDelta: 1 },
      { signalsDelta: -1, winsDelta: 0 },
      { signalsDelta: 1, winsDelta: 1 },
    ];

    let totalSignals = 50;
    let winningSignals = 35;
    let prevScore = service.calculateScore(buildMetrics()).score;

    for (const delta of outcomes) {
      totalSignals += delta.signalsDelta;
      winningSignals += delta.winsDelta;

      const fullResult = service.calculateScore(
        buildMetrics({ totalSignals, winningSignals }),
      );

      const incrResult = service.calculateIncrementalScore(
        {
          score: prevScore,
          smoothedScore: prevScore,
          totalSignals: totalSignals - delta.signalsDelta,
          winningSignals: winningSignals - delta.winsDelta,
          totalCopiers: 100,
          activeCopiers: 80,
          stakeAmount: 5000,
          avgRating: 4.2,
          ratingCount: 20,
          activeDays: 90,
          activeDaysLast30: 25,
        },
        { ...delta, newCopierCount: 80 },
      );

      expect(incrResult.score).toBe(fullResult.score);
      prevScore = fullResult.score;
    }
  });

  it('incremental smoothedScore applies EMA correctly', () => {
    const baseBreakdown = service.calculateScore(buildMetrics());

    const result = service.calculateIncrementalScore(
      {
        score: baseBreakdown.score,
        smoothedScore: 60,
        totalSignals: 50,
        winningSignals: 35,
        totalCopiers: 100,
        activeCopiers: 80,
        stakeAmount: 5000,
        avgRating: 4.2,
        ratingCount: 20,
        activeDays: 90,
        activeDaysLast30: 25,
      },
      { signalsDelta: 1, winsDelta: 1, newCopierCount: 80 },
    );

    const expectedSmoothed = 0.3 * result.score + 0.7 * 60;
    expect(result.smoothedScore).toBeCloseTo(expectedSmoothed, 1);
  });
});
