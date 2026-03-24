import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { IndicatorCalculatorService } from './indicator-calculator.service';
import { Timeframe } from '../dto/ohlcv-query.dto';

describe('IndicatorCalculatorService', () => {
  let service: IndicatorCalculatorService;
  let cacheManager: { get: jest.Mock; set: jest.Mock };

  const closePrices = Array.from({ length: 60 }, (_, i) => 0.09 + i * 0.001);
  const assetPair = 'USDC/XLM';
  const timeframe = Timeframe.ONE_HOUR;

  beforeEach(async () => {
    cacheManager = { get: jest.fn(), set: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IndicatorCalculatorService,
        { provide: CACHE_MANAGER, useValue: cacheManager },
      ],
    }).compile();

    service = module.get<IndicatorCalculatorService>(IndicatorCalculatorService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('calculateIndicators', () => {
    it('should return cached result on cache hit', async () => {
      const cached = { sma20: [1], sma50: [], ema12: [], ema26: [], rsi: [], macd: [] };
      cacheManager.get.mockResolvedValue(cached);

      const result = await service.calculateIndicators(closePrices, assetPair, timeframe);

      expect(result).toBe(cached);
      expect(cacheManager.set).not.toHaveBeenCalled();
    });

    it('should compute and cache result on cache miss', async () => {
      cacheManager.get.mockResolvedValue(null);
      cacheManager.set.mockResolvedValue(undefined);

      const result = await service.calculateIndicators(closePrices, assetPair, timeframe);

      expect(cacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining('USDC/XLM'),
        expect.any(Object),
        5 * 60 * 1000,
      );
      expect(result).toHaveProperty('sma20');
      expect(result).toHaveProperty('sma50');
      expect(result).toHaveProperty('ema12');
      expect(result).toHaveProperty('ema26');
      expect(result).toHaveProperty('rsi');
      expect(result).toHaveProperty('macd');
    });

    it('should use cache key containing assetPair, timeframe, and data length', async () => {
      cacheManager.get.mockResolvedValue(null);
      cacheManager.set.mockResolvedValue(undefined);

      await service.calculateIndicators(closePrices, 'XLM/USDC', '1h');

      const cacheKey = cacheManager.get.mock.calls[0][0] as string;
      expect(cacheKey).toContain('XLM/USDC');
      expect(cacheKey).toContain('1h');
      expect(cacheKey).toContain(String(closePrices.length));
    });

    it('should produce sma20 with nulls for first 19 elements', async () => {
      cacheManager.get.mockResolvedValue(null);
      cacheManager.set.mockResolvedValue(undefined);

      const result = await service.calculateIndicators(closePrices, assetPair, timeframe);

      for (let i = 0; i < 19; i++) {
        expect(result.sma20[i]).toBeNull();
      }
      expect(result.sma20[19]).not.toBeNull();
    });

    it('should produce sma50 with all nulls when prices < 50', async () => {
      cacheManager.get.mockResolvedValue(null);
      cacheManager.set.mockResolvedValue(undefined);

      const shortPrices = Array.from({ length: 30 }, (_, i) => i + 1);
      const result = await service.calculateIndicators(shortPrices, assetPair, timeframe);

      expect(result.sma50.every((v) => v === null)).toBe(true);
    });

    it('should produce macd array of same length as input prices', async () => {
      cacheManager.get.mockResolvedValue(null);
      cacheManager.set.mockResolvedValue(undefined);

      const result = await service.calculateIndicators(closePrices, assetPair, timeframe);

      expect(result.macd).toHaveLength(closePrices.length);
    });

    it('should handle empty prices array', async () => {
      cacheManager.get.mockResolvedValue(null);
      cacheManager.set.mockResolvedValue(undefined);

      const result = await service.calculateIndicators([], assetPair, timeframe);

      expect(result.sma20).toEqual([]);
      expect(result.macd).toEqual([]);
    });

    it('should store result with 5-minute TTL in milliseconds', async () => {
      cacheManager.get.mockResolvedValue(null);
      cacheManager.set.mockResolvedValue(undefined);

      await service.calculateIndicators(closePrices, assetPair, timeframe);

      const [, , ttl] = cacheManager.set.mock.calls[0];
      expect(ttl).toBe(300000);
    });
  });
});
