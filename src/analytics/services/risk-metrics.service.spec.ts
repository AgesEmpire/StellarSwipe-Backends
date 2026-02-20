import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { RiskMetricsService } from './risk-metrics.service';
import { StatisticalAnalysisService } from './statistical-analysis.service';
import { Trade, TradeStatus, TradeSide } from '../../trades/entities/trade.entity';
import { PriceService } from '../../shared/price.service';

describe('RiskMetricsService', () => {
  let service: RiskMetricsService;
  let tradeRepository: Repository<Trade>;
  let priceService: PriceService;

  const mockTrades: Partial<Trade>[] = Array.from({ length: 40 }, (_, i) => ({
    id: `trade-${i}`,
    userId: 'user-1',
    status: i < 30 ? TradeStatus.COMPLETED : TradeStatus.EXECUTING,
    side: TradeSide.BUY,
    baseAsset: 'XLM',
    counterAsset: 'USDC',
    amount: '1000',
    entryPrice: '0.12',
    profitLoss: i < 30 ? String((Math.random() - 0.5) * 100) : undefined,
    closedAt: i < 30 ? new Date(Date.now() - (40 - i) * 24 * 60 * 60 * 1000) : undefined,
    createdAt: new Date(Date.now() - (40 - i) * 24 * 60 * 60 * 1000),
    updatedAt: new Date(),
  }));

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskMetricsService,
        StatisticalAnalysisService,
        {
          provide: getRepositoryToken(Trade),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: PriceService,
          useValue: {
            getMultiplePrices: jest.fn().mockResolvedValue({ 'XLM/USDC': 0.13 }),
          },
        },
      ],
    }).compile();

    service = module.get<RiskMetricsService>(RiskMetricsService);
    tradeRepository = module.get<Repository<Trade>>(getRepositoryToken(Trade));
    priceService = module.get<PriceService>(PriceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateRiskMetrics', () => {
    it('should throw error for insufficient days', async () => {
      await expect(service.calculateRiskMetrics('user-1', 20)).rejects.toThrow(BadRequestException);
    });

    it('should throw error for no trade data', async () => {
      jest.spyOn(tradeRepository, 'find').mockResolvedValue([]);
      await expect(service.calculateRiskMetrics('user-1', 90)).rejects.toThrow(BadRequestException);
    });

    it('should calculate risk metrics successfully', async () => {
      jest.spyOn(tradeRepository, 'find').mockResolvedValue(mockTrades as Trade[]);

      const result = await service.calculateRiskMetrics('user-1', 90);

      expect(result).toHaveProperty('sharpeRatio');
      expect(result).toHaveProperty('maxDrawdown');
      expect(result).toHaveProperty('currentDrawdown');
      expect(result).toHaveProperty('volatility');
      expect(result).toHaveProperty('valueAtRisk95');
      expect(result).toHaveProperty('beta');
      expect(result).toHaveProperty('calculationPeriod');
      expect(result.calculationPeriod).toHaveProperty('start');
      expect(result.calculationPeriod).toHaveProperty('end');
    });

    it('should return valid numeric values', async () => {
      jest.spyOn(tradeRepository, 'find').mockResolvedValue(mockTrades as Trade[]);

      const result = await service.calculateRiskMetrics('user-1', 90);

      expect(typeof result.sharpeRatio).toBe('number');
      expect(typeof result.maxDrawdown).toBe('number');
      expect(typeof result.currentDrawdown).toBe('number');
      expect(typeof result.volatility).toBe('number');
      expect(typeof result.valueAtRisk95).toBe('number');
      expect(typeof result.beta).toBe('number');
      expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
      expect(result.currentDrawdown).toBeGreaterThanOrEqual(0);
      expect(result.volatility).toBeGreaterThanOrEqual(0);
    });
  });
});
