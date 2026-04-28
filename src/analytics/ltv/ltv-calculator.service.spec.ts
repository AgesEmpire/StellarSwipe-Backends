import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LtvCalculatorService } from './ltv-calculator.service';
import { UserLtv } from './entities/user-ltv.entity';
import { LtvSegment } from './entities/ltv-segment.entity';

const mockRepo = () => ({ findOne: jest.fn(), find: jest.fn(), upsert: jest.fn() });

const baseDto = {
  userId: 'user-1',
  subscriptionTier: 'pro' as const,
  monthsActive: 12,
  totalTradeVolume: 50000,
  tradeCount: 100,
  avgMonthlyRevenue: 50,
  engagementScore: 0.8,
  churnRisk: 0.05,
};

describe('LtvCalculatorService', () => {
  let service: LtvCalculatorService;
  let ltvRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    ltvRepo = mockRepo();
    const module = await Test.createTestingModule({
      providers: [
        LtvCalculatorService,
        { provide: getRepositoryToken(UserLtv), useValue: ltvRepo },
        { provide: getRepositoryToken(LtvSegment), useValue: mockRepo() },
      ],
    }).compile();
    service = module.get(LtvCalculatorService);
  });

  it('calculates LTV and returns all three models', async () => {
    const result = await service.calculate(baseDto);
    expect(result.userId).toBe('user-1');
    expect(result.predictedLtv).toBeGreaterThan(0);
    expect(result.historicalLtv).toBeGreaterThan(0);
    expect(result.cohortLtv).toBeGreaterThan(0);
    expect(['high', 'medium', 'low']).toContain(result.segment);
    expect(ltvRepo.upsert).toHaveBeenCalled();
  });

  it('segments high-value pro user correctly', async () => {
    const result = await service.calculate({ ...baseDto, avgMonthlyRevenue: 200, churnRisk: 0.02 });
    expect(result.segment).toBe('high');
  });

  it('segments low-value free user correctly', async () => {
    const result = await service.calculate({
      ...baseDto,
      subscriptionTier: 'free',
      avgMonthlyRevenue: 5,
      churnRisk: 0.4,
      engagementScore: 0.1,
    });
    expect(result.segment).toBe('low');
  });

  it('forecast returns monthly breakdown', async () => {
    const result = await service.forecast(baseDto, 6);
    expect(result.monthlyForecasts).toHaveLength(6);
    expect(result.monthlyForecasts[0].month).toBe(1);
    expect(result.totalForecast).toBeGreaterThan(0);
  });

  it('getByUser delegates to repository', async () => {
    ltvRepo.findOne.mockResolvedValue({ userId: 'user-1' });
    const result = await service.getByUser('user-1');
    expect(result).toEqual({ userId: 'user-1' });
  });
});
