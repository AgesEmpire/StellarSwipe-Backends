import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FraudScoringService } from './fraud-scoring.service';
import { FraudRule, FraudRuleType } from './entities/fraud-rule.entity';
import { FraudScore, FraudDecision } from './entities/fraud-score.entity';

describe('FraudScoringService', () => {
  let service: FraudScoringService;
  let mockRuleRepo: any;
  let mockScoreRepo: any;

  beforeEach(async () => {
    mockRuleRepo = { create: jest.fn(), save: jest.fn(), find: jest.fn() };
    mockScoreRepo = { create: jest.fn(), save: jest.fn(), find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FraudScoringService,
        { provide: getRepositoryToken(FraudRule), useValue: mockRuleRepo },
        { provide: getRepositoryToken(FraudScore), useValue: mockScoreRepo },
      ],
    }).compile();

    service = module.get<FraudScoringService>(FraudScoringService);
  });

  describe('scoreTransaction', () => {
    it('should return ALLOW decision for low-score transaction', async () => {
      mockRuleRepo.find.mockResolvedValue([]);
      const saved = {
        transactionId: 'tx1', userId: 'u1', totalScore: 0,
        decision: FraudDecision.ALLOW, breakdown: {}, createdAt: new Date(),
      };
      mockScoreRepo.create.mockReturnValue(saved);
      mockScoreRepo.save.mockResolvedValue(saved);

      const result = await service.scoreTransaction({ transactionId: 'tx1', userId: 'u1', amount: 100 });
      expect(result.decision).toBe(FraudDecision.ALLOW);
    });

    it('should apply amount rule and increase score', async () => {
      const rule = { id: 'r1', name: 'high-amount', ruleType: FraudRuleType.AMOUNT, scoreWeight: 60, isActive: true, conditions: { maxAmount: 500 }, createdAt: new Date() };
      mockRuleRepo.find.mockResolvedValue([rule]);
      const saved = {
        transactionId: 'tx2', userId: 'u1', totalScore: 60,
        decision: FraudDecision.BLOCK, breakdown: { 'high-amount': 60 }, createdAt: new Date(),
      };
      mockScoreRepo.create.mockReturnValue(saved);
      mockScoreRepo.save.mockResolvedValue(saved);

      const result = await service.scoreTransaction({ transactionId: 'tx2', userId: 'u1', amount: 10000 });
      expect(result.decision).toBe(FraudDecision.BLOCK);
    });
  });

  describe('createRule', () => {
    it('should create a fraud rule', async () => {
      const dto = { name: 'velocity-check', ruleType: FraudRuleType.VELOCITY, scoreWeight: 30 };
      const rule = { id: 'r1', ...dto, isActive: true, createdAt: new Date() };
      mockRuleRepo.create.mockReturnValue(rule);
      mockRuleRepo.save.mockResolvedValue(rule);

      const result = await service.createRule(dto);
      expect(result.name).toBe('velocity-check');
    });
  });
});
