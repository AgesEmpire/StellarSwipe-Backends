import { Test, TestingModule } from '@nestjs/testing';
import { ChartsService } from './charts.service';
import { OhlcvAggregatorService } from './services/ohlcv-aggregator.service';
import { IndicatorCalculatorService } from './services/indicator-calculator.service';
import { Timeframe } from './dto/ohlcv-query.dto';
import { OhlcvQueryDto } from './dto/ohlcv-query.dto';
import { IndicatorsQueryDto } from './dto/indicators-query.dto';

describe('ChartsService', () => {
  let service: ChartsService;
  let ohlcvAggregator: jest.Mocked<OhlcvAggregatorService>;
  let indicatorCalculator: jest.Mocked<IndicatorCalculatorService>;

  const mockCandles = [
    { timestamp: 1705766400000, open: 0.095, high: 0.097, low: 0.094, close: 0.096, volume: 125000 },
    { timestamp: 1705770000000, open: 0.096, high: 0.098, low: 0.095, close: 0.097, volume: 98000 },
  ];

  const mockIndicators = {
    sma20: [null, null, 0.096],
    sma50: [null],
    ema12: [null, 0.096],
    ema26: [null],
    rsi: [null, 55],
    macd: [{ macd: null, signal: null, histogram: null }],
  };

  beforeEach(async () => {
    const mockOhlcvAggregator = { getOhlcv: jest.fn() };
    const mockIndicatorCalculator = { calculateIndicators: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChartsService,
        { provide: OhlcvAggregatorService, useValue: mockOhlcvAggregator },
        { provide: IndicatorCalculatorService, useValue: mockIndicatorCalculator },
      ],
    }).compile();

    service = module.get<ChartsService>(ChartsService);
    ohlcvAggregator = module.get(OhlcvAggregatorService);
    indicatorCalculator = module.get(IndicatorCalculatorService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getOhlcv', () => {
    it('should return OhlcvResponse with assetPair, timeframe and data', async () => {
      ohlcvAggregator.getOhlcv.mockResolvedValue(mockCandles);

      const query: OhlcvQueryDto = { timeframe: Timeframe.ONE_HOUR, limit: 100 };
      const result = await service.getOhlcv('USDC/XLM', query);

      expect(result).toEqual({
        assetPair: 'USDC/XLM',
        timeframe: Timeframe.ONE_HOUR,
        data: mockCandles,
      });
    });

    it('should default timeframe to ONE_HOUR when not provided', async () => {
      ohlcvAggregator.getOhlcv.mockResolvedValue([]);

      const query: OhlcvQueryDto = {};
      await service.getOhlcv('USDC/XLM', query);

      expect(ohlcvAggregator.getOhlcv).toHaveBeenCalledWith(
        'USDC/XLM',
        Timeframe.ONE_HOUR,
        100,
      );
    });

    it('should default limit to 100 when not provided', async () => {
      ohlcvAggregator.getOhlcv.mockResolvedValue([]);

      await service.getOhlcv('XLM/USDC', {});

      const [, , limit] = ohlcvAggregator.getOhlcv.mock.calls[0];
      expect(limit).toBe(100);
    });

    it('should pass provided timeframe and limit to aggregator', async () => {
      ohlcvAggregator.getOhlcv.mockResolvedValue([]);

      await service.getOhlcv('XLM/USDC', { timeframe: Timeframe.FOUR_HOURS, limit: 50 });

      expect(ohlcvAggregator.getOhlcv).toHaveBeenCalledWith(
        'XLM/USDC',
        Timeframe.FOUR_HOURS,
        50,
      );
    });

    it('should return empty data array when aggregator returns no candles', async () => {
      ohlcvAggregator.getOhlcv.mockResolvedValue([]);

      const result = await service.getOhlcv('USDC/XLM', {});
      expect(result.data).toEqual([]);
    });
  });

  describe('getIndicators', () => {
    it('should return IndicatorsResponse with assetPair, timeframe and indicators', async () => {
      ohlcvAggregator.getOhlcv.mockResolvedValue(mockCandles);
      indicatorCalculator.calculateIndicators.mockResolvedValue(mockIndicators);

      const query: IndicatorsQueryDto = { timeframe: Timeframe.ONE_HOUR, limit: 200 };
      const result = await service.getIndicators('USDC/XLM', query);

      expect(result).toEqual({
        assetPair: 'USDC/XLM',
        timeframe: Timeframe.ONE_HOUR,
        indicators: mockIndicators,
      });
    });

    it('should extract close prices from candles and pass to indicator calculator', async () => {
      ohlcvAggregator.getOhlcv.mockResolvedValue(mockCandles);
      indicatorCalculator.calculateIndicators.mockResolvedValue(mockIndicators);

      await service.getIndicators('USDC/XLM', {});

      expect(indicatorCalculator.calculateIndicators).toHaveBeenCalledWith(
        [0.096, 0.097],
        'USDC/XLM',
        Timeframe.ONE_HOUR,
      );
    });

    it('should default timeframe to ONE_HOUR when not provided', async () => {
      ohlcvAggregator.getOhlcv.mockResolvedValue([]);
      indicatorCalculator.calculateIndicators.mockResolvedValue(mockIndicators);

      await service.getIndicators('USDC/XLM', {});

      expect(ohlcvAggregator.getOhlcv).toHaveBeenCalledWith(
        'USDC/XLM',
        Timeframe.ONE_HOUR,
        200,
      );
    });

    it('should default limit to 200 when not provided', async () => {
      ohlcvAggregator.getOhlcv.mockResolvedValue([]);
      indicatorCalculator.calculateIndicators.mockResolvedValue(mockIndicators);

      await service.getIndicators('USDC/XLM', {});

      const [, , limit] = ohlcvAggregator.getOhlcv.mock.calls[0];
      expect(limit).toBe(200);
    });

    it('should pass empty close prices when no candles returned', async () => {
      ohlcvAggregator.getOhlcv.mockResolvedValue([]);
      indicatorCalculator.calculateIndicators.mockResolvedValue(mockIndicators);

      await service.getIndicators('USDC/XLM', {});

      expect(indicatorCalculator.calculateIndicators).toHaveBeenCalledWith(
        [],
        'USDC/XLM',
        Timeframe.ONE_HOUR,
      );
    });

    it('should use provided timeframe in calculator call', async () => {
      ohlcvAggregator.getOhlcv.mockResolvedValue(mockCandles);
      indicatorCalculator.calculateIndicators.mockResolvedValue(mockIndicators);

      await service.getIndicators('USDC/XLM', { timeframe: Timeframe.ONE_DAY });

      expect(indicatorCalculator.calculateIndicators).toHaveBeenCalledWith(
        expect.any(Array),
        'USDC/XLM',
        Timeframe.ONE_DAY,
      );
    });
  });
});
