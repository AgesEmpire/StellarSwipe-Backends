import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CohortAnalyzerService } from './cohort-analyzer.service';
import { User } from '../../users/entities/user.entity';
import { Trade } from '../../trades/entities/trade.entity';
import { Signal } from '../../signals/entities/signal.entity';
import { Cohort } from './entities/cohort.entity';
import { CohortMetric } from './entities/cohort-metric.entity';

const mockRepo = () => ({
  find: jest.fn(),
  upsert: jest.fn(),
});

describe('CohortAnalyzerService', () => {
  let service: CohortAnalyzerService;
  let userRepo: ReturnType<typeof mockRepo>;
  let tradeRepo: ReturnType<typeof mockRepo>;
  let signalRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    userRepo = mockRepo();
    tradeRepo = mockRepo();
    signalRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CohortAnalyzerService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Trade), useValue: tradeRepo },
        { provide: getRepositoryToken(Signal), useValue: signalRepo },
        { provide: getRepositoryToken(Cohort), useValue: mockRepo() },
        { provide: getRepositoryToken(CohortMetric), useValue: mockRepo() },
      ],
    }).compile();

    service = module.get<CohortAnalyzerService>(CohortAnalyzerService);
  });

  it('should build cohorts for signup period', async () => {
    userRepo.find.mockResolvedValue([
      { id: 'u1', createdAt: new Date('2024-01-01T00:00:00Z') },
      { id: 'u2', createdAt: new Date('2024-01-15T00:00:00Z') },
    ]);
    tradeRepo.find.mockResolvedValue([
      { userId: 'u1', signalId: 's1', createdAt: new Date('2024-01-02T00:00:00Z') },
      { userId: 'u2', signalId: 's2', createdAt: new Date('2024-02-01T00:00:00Z') },
    ]);
    signalRepo.find.mockResolvedValue([
      { id: 's1', providerId: 'p1' },
      { id: 's2', providerId: 'p2' },
    ]);

    const result = await service.analyze({
      cohortType: 'signup_period',
      period: 'month',
      retentionPeriods: 3,
    });
    expect(result.cohorts.length).toBeGreaterThan(0);
  });
});
