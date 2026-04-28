import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PatternAnalyzerService } from './pattern-analyzer.service';
import {
  Trade,
  TradeStatus,
  TradeSide,
} from '../../trades/entities/trade.entity';
import { TradingPattern, PatternType } from './entities/trading-pattern.entity';
import { PatternInsight } from './entities/pattern-insight.entity';

const mockTrades: Partial<Trade>[] = [
  {
    id: '1',
    userId: 'user-1',
    status: TradeStatus.SETTLED,
    side: TradeSide.BUY,
    amount: '100',
    profitLoss: '10',
    executedAt: new Date('2024-01-01T10:00:00Z'),
    closedAt: new Date('2024-01-01T14:00:00Z'),
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '2',
    userId: 'user-1',
    status: TradeStatus.SETTLED,
    side: TradeSide.BUY,
    amount: '200',
    profitLoss: '-5',
    executedAt: new Date('2024-01-02T10:00:00Z'),
    closedAt: new Date('2024-01-02T11:00:00Z'),
    createdAt: new Date('2024-01-02'),
  },
  {
    id: '3',
    userId: 'user-1',
    status: TradeStatus.SETTLED,
    side: TradeSide.SELL,
    amount: '150',
    profitLoss: '20',
    executedAt: new Date('2024-01-03T10:00:00Z'),
    closedAt: new Date('2024-01-03T16:00:00Z'),
    createdAt: new Date('2024-01-03'),
  },
];

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  delete: jest.fn(),
});

describe('PatternAnalyzerService', () => {
  let service: PatternAnalyzerService;
  let tradeRepo: ReturnType<typeof mockRepo>;
  let patternRepo: ReturnType<typeof mockRepo>;
  let insightRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    tradeRepo = mockRepo();
    patternRepo = mockRepo();
    insightRepo = mockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatternAnalyzerService,
        { provide: getRepositoryToken(Trade), useValue: tradeRepo },
        { provide: getRepositoryToken(TradingPattern), useValue: patternRepo },
        { provide: getRepositoryToken(PatternInsight), useValue: insightRepo },
      ],
    }).compile();

    service = module.get<PatternAnalyzerService>(PatternAnalyzerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyze', () => {
    beforeEach(() => {
      tradeRepo.find.mockResolvedValue(mockTrades);
      patternRepo.findOne.mockResolvedValue(null);
      patternRepo.save.mockImplementation((v) =>
        Promise.resolve({ id: 'pattern-id', ...v }),
      );
      insightRepo.delete.mockResolvedValue({});
      insightRepo.save.mockResolvedValue([]);
    });

    it('should return patterns, insights, and suggestions', async () => {
      const result = await service.analyze({ userId: 'user-1' });
      expect(result).toHaveProperty('patterns');
      expect(result).toHaveProperty('insights');
      expect(result).toHaveProperty('suggestions');
      expect(patternRepo.save).toHaveBeenCalledTimes(4);
    });

    it('should handle zero trades gracefully', async () => {
      tradeRepo.find.mockResolvedValue([]);
      const result = await service.analyze({ userId: 'user-1' });
      expect(result.patterns).toHaveLength(4);
      expect(result.insights).toHaveLength(0);
      expect(result.suggestions).toHaveLength(0);
    });

    it('should save one pattern per type', async () => {
      await service.analyze({ userId: 'user-1' });
      const savedTypes = patternRepo.save.mock.calls.map(
        (c) => c[0].patternType,
      );
      expect(savedTypes).toContain(PatternType.WIN_LOSS);
      expect(savedTypes).toContain(PatternType.TIMING);
      expect(savedTypes).toContain(PatternType.SIZING);
      expect(savedTypes).toContain(PatternType.HOLDING_PERIOD);
    });

    it('should update existing pattern on re-analysis', async () => {
      const existing = {
        id: 'existing-id',
        userId: 'user-1',
        patternType: PatternType.WIN_LOSS,
        metrics: {},
        analyzedAt: new Date(),
      };
      patternRepo.findOne.mockResolvedValue(existing);
      await service.analyze({ userId: 'user-1' });
      expect(patternRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'existing-id' }),
      );
    });

    it('should save insights if patterns are matched', async () => {
      // Mock trades that will trigger insights in pattern-matcher
      const winningTrades = Array(10).fill({
        status: TradeStatus.SETTLED,
        profitLoss: '100',
        amount: '10',
      });
      tradeRepo.find.mockResolvedValue(winningTrades);

      const result = await service.analyze({ userId: 'user-1' });
      expect(result.insights.length).toBeGreaterThan(0);
      expect(insightRepo.save).toHaveBeenCalled();
    });
  });

  describe('getPatterns', () => {
    it('should return patterns for user', async () => {
      patternRepo.find.mockResolvedValue([{ id: 'p1', userId: 'user-1' }]);
      const result = await service.getPatterns('user-1');
      expect(result).toHaveLength(1);
      expect(patternRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });

  describe('getInsights', () => {
    it('should return insights for user', async () => {
      insightRepo.find.mockResolvedValue([{ id: 'i1', userId: 'user-1' }]);
      const result = await service.getInsights('user-1');
      expect(result).toHaveLength(1);
      expect(insightRepo.find).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
    });
  });
});
