import { Test, TestingModule } from '@nestjs/testing';
import { ChartsController } from './charts.controller';
import { ChartsService } from './charts.service';
import { Timeframe } from './dto/ohlcv-query.dto';

describe('ChartsController', () => {
  let controller: ChartsController;
  let chartsService: jest.Mocked<ChartsService>;

  const mockOhlcvResponse = {
    assetPair: 'USDC/XLM',
    timeframe: Timeframe.ONE_HOUR,
    data: [
      { timestamp: 1705766400000, open: 0.095, high: 0.097, low: 0.094, close: 0.096, volume: 125000 },
    ],
  };

  const mockIndicatorsResponse = {
    assetPair: 'USDC/XLM',
    timeframe: Timeframe.ONE_HOUR,
    indicators: {
      sma20: [null, 0.096],
      sma50: [null],
      ema12: [null, 0.096],
      ema26: [null],
      rsi: [null, 55],
      macd: [{ macd: null, signal: null, histogram: null }],
    },
  };

  beforeEach(async () => {
    const mockChartsService = {
      getOhlcv: jest.fn(),
      getIndicators: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChartsController],
      providers: [
        { provide: ChartsService, useValue: mockChartsService },
      ],
    }).compile();

    controller = module.get<ChartsController>(ChartsController);
    chartsService = module.get(ChartsService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getOhlcv', () => {
    it('should call chartsService.getOhlcv and return its result', async () => {
      chartsService.getOhlcv.mockResolvedValue(mockOhlcvResponse);

      const query = { timeframe: Timeframe.ONE_HOUR, limit: 100 };
      const result = await controller.getOhlcv('USDC%2FXLM', query);

      expect(chartsService.getOhlcv).toHaveBeenCalledWith('USDC%2FXLM', query);
      expect(result).toBe(mockOhlcvResponse);
    });

    it('should pass empty query object to service', async () => {
      chartsService.getOhlcv.mockResolvedValue(mockOhlcvResponse);

      await controller.getOhlcv('USDC/XLM', {});

      expect(chartsService.getOhlcv).toHaveBeenCalledWith('USDC/XLM', {});
    });

    it('should pass different timeframes correctly', async () => {
      chartsService.getOhlcv.mockResolvedValue(mockOhlcvResponse);

      await controller.getOhlcv('XLM/USDC', { timeframe: Timeframe.ONE_DAY });

      expect(chartsService.getOhlcv).toHaveBeenCalledWith(
        'XLM/USDC',
        { timeframe: Timeframe.ONE_DAY },
      );
    });
  });

  describe('getIndicators', () => {
    it('should call chartsService.getIndicators and return its result', async () => {
      chartsService.getIndicators.mockResolvedValue(mockIndicatorsResponse);

      const query = { timeframe: Timeframe.ONE_HOUR, limit: 200 };
      const result = await controller.getIndicators('USDC/XLM', query);

      expect(chartsService.getIndicators).toHaveBeenCalledWith('USDC/XLM', query);
      expect(result).toBe(mockIndicatorsResponse);
    });

    it('should pass empty query object to service', async () => {
      chartsService.getIndicators.mockResolvedValue(mockIndicatorsResponse);

      await controller.getIndicators('USDC/XLM', {});

      expect(chartsService.getIndicators).toHaveBeenCalledWith('USDC/XLM', {});
    });

    it('should forward the assetPair path param unchanged', async () => {
      chartsService.getIndicators.mockResolvedValue(mockIndicatorsResponse);

      await controller.getIndicators('XLM-USDC', {});

      const [assetPair] = chartsService.getIndicators.mock.calls[0];
      expect(assetPair).toBe('XLM-USDC');
    });
  });
});
