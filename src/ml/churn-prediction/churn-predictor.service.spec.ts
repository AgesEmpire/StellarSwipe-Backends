import { Test, TestingModule } from '@nestjs/testing';
import { ChurnPredictorService } from './churn-predictor.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChurnPrediction } from './entities/churn-prediction.entity';
import { RetentionCampaign } from './entities/retention-campaign.entity';
import { ChurnClassifierModel } from './models/churn-classifier.model';
import { RiskScorerModel } from './models/risk-scorer.model';

const mockRepo = () => ({
  create: jest.fn((d) => ({ id: 'pred-1', ...d })),
  save: jest.fn((d) => Promise.resolve(d)),
  update: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
});

const lowEngagementFeatures = {
  daysSinceLastLogin: 30,
  loginFrequency7d: 0,
  tradeCount30d: 0,
  signalViewCount30d: 0,
  portfolioCheckCount7d: 0,
};

const highEngagementFeatures = {
  daysSinceLastLogin: 1,
  loginFrequency7d: 7,
  tradeCount30d: 20,
  signalViewCount30d: 50,
  portfolioCheckCount7d: 10,
};

describe('ChurnPredictorService', () => {
  let service: ChurnPredictorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChurnPredictorService,
        ChurnClassifierModel,
        RiskScorerModel,
        { provide: getRepositoryToken(ChurnPrediction), useFactory: mockRepo },
        { provide: getRepositoryToken(RetentionCampaign), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get(ChurnPredictorService);
  });

  it('should assign high risk to inactive user', async () => {
    const result = await service.predictForUser('user-1', lowEngagementFeatures);
    expect(result.riskScore).toBeGreaterThan(0.5);
    expect(['high', 'critical']).toContain(result.riskLevel);
  });

  it('should assign low risk to active user', async () => {
    const result = await service.predictForUser('user-2', highEngagementFeatures);
    expect(result.riskScore).toBeLessThan(0.5);
    expect(['low', 'medium']).toContain(result.riskLevel);
  });

  it('should trigger retention campaign for high-risk prediction', async () => {
    const prediction: ChurnPrediction = {
      id: 'pred-1', userId: 'user-1', riskScore: 0.85,
      riskLevel: 'critical', daysSinceLastLogin: 30,
      engagementScore: 10, retentionTriggered: false, createdAt: new Date(),
    };
    const campaign = await service.triggerRetention(prediction);
    expect(campaign.userId).toBe('user-1');
    expect(campaign.actionType).toBeDefined();
  });

  it('should return empty high-risk list when none exist', async () => {
    const result = await service.getHighRiskUsers();
    expect(result).toEqual([]);
  });
});
