import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SlippageCalculatorService } from './slippage-calculator.service';
import { SlippageToleranceLevel } from './dto/slippage-config.dto';
import { MarketDepth } from './market-depth.types';
import { OrderBookService } from './order-book.service';

const makeBook = (): MarketDepth => ({
  symbol: 'BTC/USD',
  bids: Array.from({ length: 20 }, (_, i) => ({
    price: 45000 - (i + 1) * 10,
    quantity: 1,
  })),
  asks: Array.from({ length: 20 }, (_, i) => ({
    price: 45000 + (i + 1) * 10,
    quantity: 1,
  })),
  timestamp: new Date('2026-01-01T00:00:00.000Z'),
});

describe('SlippageCalculatorService', () => {
  let service: SlippageCalculatorService;
  let orderBookMock: {
    fetchMarketDepth: jest.Mock;
    validateAndNormalise: jest.Mock;
    walkBook: jest.Mock;
  };
  const realOrderBook = new OrderBookService();

  beforeEach(async () => {
    orderBookMock = {
      fetchMarketDepth: jest.fn(async (_symbol: string) => makeBook()),
      validateAndNormalise: jest.fn((book: MarketDepth) =>
        realOrderBook.validateAndNormalise(book),
      ),
      walkBook: jest.fn(
        (side: 'buy' | 'sell', book: MarketDepth, quantity: number) =>
          realOrderBook.walkBook(side, book, quantity),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlippageCalculatorService,
        { provide: OrderBookService, useValue: orderBookMock },
      ],
    }).compile();

    service = module.get<SlippageCalculatorService>(SlippageCalculatorService);
  });

  afterEach(() => {
    service.clearHistoricalData();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('estimateSlippage', () => {
    it('should estimate slippage for a buy order', async () => {
      const result = await service.estimateSlippage({
        symbol: 'BTC/USD',
        side: 'buy',
        quantity: 1.0,
      });

      expect(result).toBeDefined();
      expect(result.estimatedSlippagePercent).toBeGreaterThanOrEqual(0);
      expect(result.currentMarketPrice).toBeGreaterThan(0);
      expect(result.liquidityScore).toBeGreaterThanOrEqual(0);
      expect(result.liquidityScore).toBeLessThanOrEqual(1);
      expect(['proceed', 'caution', 'delay']).toContain(result.recommendation);
    });

    it('should estimate slippage for a sell order', async () => {
      const result = await service.estimateSlippage({
        symbol: 'ETH/USD',
        side: 'sell',
        quantity: 5.0,
      });

      expect(result).toBeDefined();
      expect(result.estimatedSlippagePercent).toBeGreaterThanOrEqual(0);
    });

    it('should provide price range estimate', async () => {
      const result = await service.estimateSlippage({
        symbol: 'BTC/USD',
        side: 'buy',
        quantity: 0.5,
        expectedPrice: 45000,
      });

      expect(result.estimatedPriceRange).toBeDefined();
      expect(result.estimatedPriceRange.min).toBeLessThan(
        result.estimatedPriceRange.max,
      );
      expect(result.estimatedPriceRange.min).toBeGreaterThan(0);
    });

    it('should recommend delay for very large orders', async () => {
      const result = await service.estimateSlippage({
        symbol: 'BTC/USD',
        side: 'buy',
        quantity: 100, // Very large order
      });

      // Large orders should trigger caution or delay
      expect(['caution', 'delay']).toContain(result.recommendation);
    });

    it('should complete estimation quickly', async () => {
      const start = Date.now();

      await service.estimateSlippage({
        symbol: 'BTC/USD',
        side: 'buy',
        quantity: 1.0,
      });

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000); // Should complete in under 1 second
    });
  });

  describe('order book depth', () => {
    it('consumes asks for buys and bids for sells', async () => {
      const book = makeBook();

      await service.estimateSlippage({
        symbol: 'BTC/USD',
        side: 'buy',
        quantity: 2,
      });
      expect(orderBookMock.walkBook).toHaveBeenLastCalledWith('buy', book, 2);

      await service.estimateSlippage({
        symbol: 'BTC/USD',
        side: 'sell',
        quantity: 2,
      });
      expect(orderBookMock.walkBook).toHaveBeenLastCalledWith('sell', book, 2);
    });

    it('prices buys off the asks even when the book sides are asymmetric', async () => {
      const asymmetric: MarketDepth = {
        symbol: 'BTC/USD',
        bids: [
          { price: 40000, quantity: 100 },
          { price: 39990, quantity: 100 },
        ],
        asks: [
          { price: 45000, quantity: 1 },
          { price: 46000, quantity: 100 },
        ],
        timestamp: new Date(),
      };
      orderBookMock.fetchMarketDepth.mockResolvedValue(asymmetric);

      const buy = await service.estimateSlippage({
        symbol: 'BTC/USD',
        side: 'buy',
        quantity: 2,
        expectedPrice: 45000,
      });
      // 1 @ 45000 + 1 @ 46000 = 45500
      expect(buy.estimatedSlippagePercent).toBeCloseTo(1.111, 2);

      const sell = await service.estimateSlippage({
        symbol: 'BTC/USD',
        side: 'sell',
        quantity: 2,
        expectedPrice: 45000,
      });
      // 2 @ 40000 = 40000, a favourable 11.11% move away from expected
      expect(sell.estimatedSlippagePercent).toBeCloseTo(11.111, 2);
    });

    it('surfaces insufficient depth in the reasoning', async () => {
      orderBookMock.fetchMarketDepth.mockResolvedValue({
        symbol: 'BTC/USD',
        bids: [{ price: 44990, quantity: 1 }],
        asks: [{ price: 45010, quantity: 1 }],
        timestamp: new Date(),
      });

      const result = await service.estimateSlippage({
        symbol: 'BTC/USD',
        side: 'buy',
        quantity: 10,
      });

      expect(result.reasoning).toContain('depth');
    });

    it('fails safely when the order book is malformed', async () => {
      orderBookMock.fetchMarketDepth.mockRejectedValue(
        new BadRequestException('Order book is crossed'),
      );

      await expect(
        service.estimateSlippage({
          symbol: 'BTC/USD',
          side: 'buy',
          quantity: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('fails safely when a caller supplied book is empty', async () => {
      await expect(
        service.estimateSlippage(
          { symbol: 'BTC/USD', side: 'buy', quantity: 1 },
          { symbol: 'BTC/USD', bids: [], asks: [], timestamp: new Date() },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('calculateActualSlippage', () => {
    it('should calculate slippage correctly for favorable execution', () => {
      const result = service.calculateActualSlippage(
        45000, // expected
        44950, // actual (better price for buy)
        1.0,   // quantity
      );

      expect(result.slippageAmount).toBe(50);
      expect(result.slippagePercent).toBeCloseTo(0.111, 2);
      expect(result.totalCost).toBe(50);
    });

    it('should calculate slippage correctly for unfavorable execution', () => {
      const result = service.calculateActualSlippage(
        45000, // expected
        45100, // actual (worse price)
        2.0,   // quantity
      );

      expect(result.slippageAmount).toBe(100);
      expect(result.slippagePercent).toBeCloseTo(0.222, 2);
      expect(result.totalCost).toBe(200);
    });

    it('should handle zero slippage', () => {
      const result = service.calculateActualSlippage(
        45000,
        45000,
        1.0,
      );

      expect(result.slippageAmount).toBe(0);
      expect(result.slippagePercent).toBe(0);
      expect(result.totalCost).toBe(0);
    });

    it('should calculate total cost correctly', () => {
      const quantity = 5.5;
      const slippagePerUnit = 25;

      const result = service.calculateActualSlippage(
        10000,
        10000 + slippagePerUnit,
        quantity,
      );

      expect(result.totalCost).toBe(slippagePerUnit * quantity);
    });
  });

  describe('updateHistoricalSlippage', () => {
    it('should initialize historical data for new symbol', () => {
      service.updateHistoricalSlippage('BTC/USD', 0.25);

      const stats = service['getHistoricalSlippage']('BTC/USD');
      expect(stats).toBeDefined();
      expect(stats!.averageSlippage).toBe(0.25);
      expect(stats!.maxSlippage).toBe(0.25);
      expect(stats!.sampleCount).toBe(1);
    });

    it('should update running average correctly', () => {
      service.updateHistoricalSlippage('BTC/USD', 0.2);
      service.updateHistoricalSlippage('BTC/USD', 0.4);
      service.updateHistoricalSlippage('BTC/USD', 0.3);

      const stats = service['getHistoricalSlippage']('BTC/USD');
      expect(stats!.averageSlippage).toBeCloseTo(0.3, 2);
      expect(stats!.sampleCount).toBe(3);
    });

    it('should track maximum slippage', () => {
      service.updateHistoricalSlippage('ETH/USD', 0.1);
      service.updateHistoricalSlippage('ETH/USD', 0.5);
      service.updateHistoricalSlippage('ETH/USD', 0.2);

      const stats = service['getHistoricalSlippage']('ETH/USD');
      expect(stats!.maxSlippage).toBe(0.5);
    });

    it('should maintain separate data for different symbols', () => {
      service.updateHistoricalSlippage('BTC/USD', 0.3);
      service.updateHistoricalSlippage('ETH/USD', 0.6);

      const btcStats = service['getHistoricalSlippage']('BTC/USD');
      const ethStats = service['getHistoricalSlippage']('ETH/USD');

      expect(btcStats!.averageSlippage).toBe(0.3);
      expect(ethStats!.averageSlippage).toBe(0.6);
    });
  });

  describe('getToleranceForLevel', () => {
    it('should return correct tolerance for STRICT level', () => {
      const tolerance = service.getToleranceForLevel(
        SlippageToleranceLevel.STRICT,
      );
      expect(tolerance).toBe(0.1);
    });

    it('should return correct tolerance for MODERATE level', () => {
      const tolerance = service.getToleranceForLevel(
        SlippageToleranceLevel.MODERATE,
      );
      expect(tolerance).toBe(0.5);
    });

    it('should return correct tolerance for RELAXED level', () => {
      const tolerance = service.getToleranceForLevel(
        SlippageToleranceLevel.RELAXED,
      );
      expect(tolerance).toBe(1.0);
    });
  });

  describe('calculateDynamicTolerance', () => {
    it('should increase tolerance in low liquidity', () => {
      const baseTolerance = 0.5;
      const lowLiquidity = 0.3;

      const result = service.calculateDynamicTolerance(
        baseTolerance,
        lowLiquidity,
        1.0, // normal volatility
      );

      expect(result).toBeGreaterThan(baseTolerance);
    });

    it('should increase tolerance in high volatility', () => {
      const baseTolerance = 0.5;
      const normalLiquidity = 0.8;
      const highVolatility = 5.0;

      const result = service.calculateDynamicTolerance(
        baseTolerance,
        normalLiquidity,
        highVolatility,
      );

      expect(result).toBeGreaterThan(baseTolerance);
    });

    it('should not increase tolerance excessively', () => {
      const baseTolerance = 0.5;
      const veryLowLiquidity = 0.1;
      const extremeVolatility = 100;

      const result = service.calculateDynamicTolerance(
        baseTolerance,
        veryLowLiquidity,
        extremeVolatility,
      );

      // Should cap at 3x base tolerance
      expect(result).toBeLessThanOrEqual(baseTolerance * 3);
    });

    it('should maintain base tolerance in good conditions', () => {
      const baseTolerance = 0.5;
      const goodLiquidity = 0.9;
      const lowVolatility = 0.5;

      const result = service.calculateDynamicTolerance(
        baseTolerance,
        goodLiquidity,
        lowVolatility,
      );

      expect(result).toBeCloseTo(baseTolerance, 1);
    });
  });

  describe('clearHistoricalData', () => {
    it('should clear data for specific symbol', () => {
      service.updateHistoricalSlippage('BTC/USD', 0.3);
      service.updateHistoricalSlippage('ETH/USD', 0.4);

      service.clearHistoricalData('BTC/USD');

      expect(service['getHistoricalSlippage']('BTC/USD')).toBeUndefined();
      expect(service['getHistoricalSlippage']('ETH/USD')).toBeDefined();
    });

    it('should clear all data when no symbol specified', () => {
      service.updateHistoricalSlippage('BTC/USD', 0.3);
      service.updateHistoricalSlippage('ETH/USD', 0.4);

      service.clearHistoricalData();

      expect(service['getHistoricalSlippage']('BTC/USD')).toBeUndefined();
      expect(service['getHistoricalSlippage']('ETH/USD')).toBeUndefined();
    });
  });
});
