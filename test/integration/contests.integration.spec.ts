import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContestsModule } from '../../src/contests/contests.module';
import { ContestsService } from '../../src/contests/contests.service';
import { Contest, ContestMetric, ContestStatus } from '../../src/contests/entities/contest.entity';
import { Signal, SignalStatus } from '../../src/signals/entities/signal.entity';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';

describe('Contests Integration Tests', () => {
  let app: INestApplication;
  let contestsService: ContestsService;
  let contestRepository: Repository<Contest>;
  let signalRepository: Repository<Signal>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DATABASE_HOST || 'localhost',
          port: parseInt(process.env.DATABASE_PORT || '5432'),
          username: process.env.DATABASE_USER || 'test',
          password: process.env.DATABASE_PASSWORD || 'test',
          database: process.env.DATABASE_NAME || 'test',
          entities: [Contest, Signal],
          synchronize: true,
          dropSchema: true,
        }),
        ContestsModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    contestsService = moduleFixture.get<ContestsService>(ContestsService);
    contestRepository = moduleFixture.get<Repository<Contest>>(getRepositoryToken(Contest));
    signalRepository = moduleFixture.get<Repository<Signal>>(getRepositoryToken(Signal));
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    await signalRepository.delete({});
    await contestRepository.delete({});
  });

  describe('Complete Contest Flow', () => {
    it('should create weekly contest for Highest ROI', async () => {
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + 7 * 24 * 60 * 60 * 1000);

      const contest = await contestsService.createContest({
        name: 'Weekly Highest ROI Contest',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        metric: ContestMetric.HIGHEST_ROI,
        minSignals: 2,
        prizePool: '1000',
      });

      expect(contest).toBeDefined();
      expect(contest.id).toBeDefined();
      expect(contest.name).toBe('Weekly Highest ROI Contest');
      expect(contest.status).toBe(ContestStatus.ACTIVE);
    });

    it('should submit signals from 3 providers during week', async () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-08T00:00:00Z');

      const contest = await contestsService.createContest({
        name: 'Test Contest',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        metric: ContestMetric.HIGHEST_ROI,
        minSignals: 2,
        prizePool: '1000',
      });

      // Provider 1: High ROI
      await signalRepository.save([
        {
          providerId: 'provider1',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          type: 'BUY',
          status: SignalStatus.CLOSED,
          entryPrice: '100',
          targetPrice: '200',
          closePrice: '200',
          totalCopiedVolume: '5000',
          totalProfitLoss: '100',
          expiresAt: endTime,
          createdAt: new Date('2024-01-02T00:00:00Z'),
        },
        {
          providerId: 'provider1',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          type: 'BUY',
          status: SignalStatus.CLOSED,
          entryPrice: '100',
          targetPrice: '180',
          closePrice: '180',
          totalCopiedVolume: '3000',
          totalProfitLoss: '80',
          expiresAt: endTime,
          createdAt: new Date('2024-01-03T00:00:00Z'),
        },
      ]);

      // Provider 2: Medium ROI
      await signalRepository.save([
        {
          providerId: 'provider2',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          type: 'BUY',
          status: SignalStatus.CLOSED,
          entryPrice: '100',
          targetPrice: '150',
          closePrice: '150',
          totalCopiedVolume: '2000',
          totalProfitLoss: '50',
          expiresAt: endTime,
          createdAt: new Date('2024-01-04T00:00:00Z'),
        },
        {
          providerId: 'provider2',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          type: 'BUY',
          status: SignalStatus.CLOSED,
          entryPrice: '100',
          targetPrice: '140',
          closePrice: '140',
          totalCopiedVolume: '1500',
          totalProfitLoss: '40',
          expiresAt: endTime,
          createdAt: new Date('2024-01-05T00:00:00Z'),
        },
      ]);

      // Provider 3: Low ROI
      await signalRepository.save([
        {
          providerId: 'provider3',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          type: 'BUY',
          status: SignalStatus.CLOSED,
          entryPrice: '100',
          targetPrice: '120',
          closePrice: '120',
          totalCopiedVolume: '1000',
          totalProfitLoss: '20',
          expiresAt: endTime,
          createdAt: new Date('2024-01-06T00:00:00Z'),
        },
        {
          providerId: 'provider3',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          type: 'BUY',
          status: SignalStatus.CLOSED,
          entryPrice: '100',
          targetPrice: '115',
          closePrice: '115',
          totalCopiedVolume: '800',
          totalProfitLoss: '15',
          expiresAt: endTime,
          createdAt: new Date('2024-01-07T00:00:00Z'),
        },
      ]);

      const leaderboard = await contestsService.getContestLeaderboard(contest.id);

      expect(leaderboard.entries).toHaveLength(3);
      expect(leaderboard.entries[0].provider).toBe('provider1');
    });

    it('should finalize contest at end and verify winner has highest ROI', async () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-08T00:00:00Z');

      const contest = await contestsService.createContest({
        name: 'Test Contest',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        metric: ContestMetric.HIGHEST_ROI,
        minSignals: 2,
        prizePool: '1000',
      });

      await signalRepository.save([
        {
          providerId: 'provider1',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          type: 'BUY',
          status: SignalStatus.CLOSED,
          entryPrice: '100',
          targetPrice: '200',
          closePrice: '200',
          totalCopiedVolume: '5000',
          totalProfitLoss: '100',
          expiresAt: endTime,
          createdAt: new Date('2024-01-02T00:00:00Z'),
        },
        {
          providerId: 'provider1',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          type: 'BUY',
          status: SignalStatus.CLOSED,
          entryPrice: '100',
          targetPrice: '180',
          closePrice: '180',
          totalCopiedVolume: '3000',
          totalProfitLoss: '80',
          expiresAt: endTime,
          createdAt: new Date('2024-01-03T00:00:00Z'),
        },
      ]);

      const result = await contestsService.finalizeContest(contest.id);

      expect(result.winners).toHaveLength(1);
      expect(result.winners[0]).toBe('provider1');
      expect(result.prizes['provider1']).toBe('500.00000000');

      const updatedContest = await contestsService.getContest(contest.id);
      expect(updatedContest.status).toBe(ContestStatus.FINALIZED);
      expect(updatedContest.winners).toEqual(['provider1']);
    });

    it('should check prize distribution is correct', async () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-08T00:00:00Z');

      const contest = await contestsService.createContest({
        name: 'Prize Distribution Test',
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        metric: ContestMetric.HIGHEST_ROI,
        minSignals: 1,
        prizePool: '1000',
      });

      await signalRepository.save([
        {
          providerId: 'provider1',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          type: 'BUY',
          status: SignalStatus.CLOSED,
          entryPrice: '100',
          closePrice: '300',
          totalCopiedVolume: '5000',
          totalProfitLoss: '200',
          expiresAt: endTime,
          createdAt: new Date('2024-01-02T00:00:00Z'),
        },
        {
          providerId: 'provider2',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          type: 'BUY',
          status: SignalStatus.CLOSED,
          entryPrice: '100',
          closePrice: '200',
          totalCopiedVolume: '3000',
          totalProfitLoss: '100',
          expiresAt: endTime,
          createdAt: new Date('2024-01-03T00:00:00Z'),
        },
        {
          providerId: 'provider3',
          baseAsset: 'XLM',
          counterAsset: 'USDC',
          type: 'BUY',
          status: SignalStatus.CLOSED,
          entryPrice: '100',
          closePrice: '150',
          totalCopiedVolume: '2000',
          totalProfitLoss: '50',
          expiresAt: endTime,
          createdAt: new Date('2024-01-04T00:00:00Z'),
        },
      ]);

      const result = await contestsService.finalizeContest(contest.id);

      expect(result.winners).toHaveLength(3);
      expect(result.prizes['provider1']).toBe('500.00000000'); // 50%
      expect(result.prizes['provider2']).toBe('300.00000000'); // 30%
      expect(result.prizes['provider3']).toBe('200.00000000'); // 20%
    });
  });
});
