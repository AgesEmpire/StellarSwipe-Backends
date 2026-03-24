import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { OhlcvAggregatorService } from './ohlcv-aggregator.service';
import { Timeframe, TIMEFRAME_SECONDS } from '../dto/ohlcv-query.dto';

describe('OhlcvAggregatorService', () => {
  let service: OhlcvAggregatorService;
  let dataSource: { query: jest.Mock };

  const mockRows = [
    {
      timestamp_ms: '1705766400000',
      open: '0.095',
      high: '0.097',
      low: '0.094',
      close: '0.096',
      volume: '125000',
    },
    {
      timestamp_ms: '1705770000000',
      open: '0.096',
      high: '0.098',
      low: '0.095',
      close: '0.097',
      volume: '98000',
    },
  ];

  beforeEach(async () => {
    dataSource = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OhlcvAggregatorService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<OhlcvAggregatorService>(OhlcvAggregatorService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('timeframeToSeconds', () => {
    it.each([
      [Timeframe.ONE_MINUTE, 60],
      [Timeframe.FIVE_MINUTES, 300],
      [Timeframe.FIFTEEN_MINUTES, 900],
      [Timeframe.ONE_HOUR, 3600],
      [Timeframe.FOUR_HOURS, 14400],
      [Timeframe.ONE_DAY, 86400],
      [Timeframe.ONE_WEEK, 604800],
    ])('should return %d seconds for %s', (tf, expected) => {
      expect(service.timeframeToSeconds(tf)).toBe(expected);
    });

    it('should match TIMEFRAME_SECONDS constant', () => {
      Object.entries(TIMEFRAME_SECONDS).forEach(([tf, secs]) => {
        expect(service.timeframeToSeconds(tf as Timeframe)).toBe(secs);
      });
    });
  });

  describe('getOhlcv', () => {
    it('should return parsed OhlcvCandle array', async () => {
      dataSource.query.mockResolvedValue(mockRows);

      const result = await service.getOhlcv('USDC/XLM', Timeframe.ONE_HOUR, 100);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        timestamp: 1705766400000,
        open: 0.095,
        high: 0.097,
        low: 0.094,
        close: 0.096,
        volume: 125000,
      });
    });

    it('should return empty array when no rows found', async () => {
      dataSource.query.mockResolvedValue([]);
      const result = await service.getOhlcv('USDC/XLM', Timeframe.ONE_HOUR, 100);
      expect(result).toEqual([]);
    });

    it('should call dataSource.query with correct parameters', async () => {
      dataSource.query.mockResolvedValue([]);

      await service.getOhlcv('XLM/USDC', Timeframe.FIVE_MINUTES, 50);

      expect(dataSource.query).toHaveBeenCalledWith(
        expect.any(String),
        ['XLM/USDC', expect.any(Number), 300, 50],
      );
    });

    it('should calculate lookback as intervalSecs * limit * 2', async () => {
      dataSource.query.mockResolvedValue([]);

      await service.getOhlcv('XLM/USDC', Timeframe.ONE_HOUR, 100);

      const [, lookback] = dataSource.query.mock.calls[0][1];
      expect(lookback).toBe(3600 * 100 * 2);
    });

    it('should pass intervalSecs as third param to query', async () => {
      dataSource.query.mockResolvedValue([]);

      await service.getOhlcv('XLM/USDC', Timeframe.ONE_DAY, 10);

      const [, , intervalSecs] = dataSource.query.mock.calls[0][1];
      expect(intervalSecs).toBe(86400);
    });

    it('should parse all numeric fields correctly', async () => {
      dataSource.query.mockResolvedValue([
        {
          timestamp_ms: '9999999999999',
          open: '1.23456789',
          high: '9.87654321',
          low: '0.00000001',
          close: '5.55555555',
          volume: '1000000',
        },
      ]);

      const result = await service.getOhlcv('XLM/USDC', Timeframe.ONE_HOUR, 1);
      expect(result[0].timestamp).toBe(9999999999999);
      expect(result[0].open).toBeCloseTo(1.23456789, 6);
      expect(result[0].high).toBeCloseTo(9.87654321, 6);
      expect(result[0].low).toBeCloseTo(0.00000001, 9);
      expect(result[0].close).toBeCloseTo(5.55555555, 6);
      expect(result[0].volume).toBe(1000000);
    });

    it('should work for all supported timeframes', async () => {
      dataSource.query.mockResolvedValue([]);

      for (const tf of Object.values(Timeframe)) {
        await service.getOhlcv('USDC/XLM', tf, 10);
      }

      expect(dataSource.query).toHaveBeenCalledTimes(Object.values(Timeframe).length);
    });
  });
});
