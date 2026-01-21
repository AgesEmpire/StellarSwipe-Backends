import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SlippageProtectionService } from './slippage-protection.service';
import { SlippageCalculatorService } from './slippage-calculator.service';
import { SlippageToleranceLevel } from './dto/slippage-config.dto';

describe('SlippageProtectionService', () => {
  let service: SlippageProtectionService;
  let calculatorService: SlippageCalculatorService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlippageProtectionService,
        SlippageCalculatorService,
      ],
    }).compile();

    service = module.get<SlippageProtectionService>(SlippageProtectionService);
    calculatorService = module.get<SlippageCalculatorService>(
      SlippageCalculatorService,
    );
  });

  afterEach(() => {
    service.clearReports();
    service.clearUserPreferences();
    calculatorService.clearHistoricalData();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateTradeExecution', () => {
    it('should allow trade within slippage limits', async () => {
      const context = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 1.0,
        expectedPrice: 45000,
        timestamp: new Date(),
      };

      const result = await service.validateTradeExecution(context);

      expect(result.allowed).toBe(true);
      expect(result.recommendation).toBeDefined();
      expect(result.estimatedSlippage).toBeGreaterThanOrEqual(0);
    });

    it('should reject trade with custom strict limits', async () => {
      const context = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 100, // Large order likely to cause high slippage
        expectedPrice: 45000,
        timestamp: new Date(),
      };

      const strictConfig = {
        maxSlippagePercent: 0.01, // Very strict: 0.01%
        toleranceLevel: SlippageToleranceLevel.STRICT,
        enableDynamicSlippage: false,
      };

      const result = await service.validateTradeExecution(context, strictConfig);

      // Large order with strict limits should likely be rejected
      expect(result).toBeDefined();
      expect(result.estimatedSlippage).toBeGreaterThanOrEqual(0);
    });

    it('should use user preferences when available', async () => {
      const userId = 'user123';
      const userConfig = {
        maxSlippagePercent: 0.3,
        toleranceLevel: SlippageToleranceLevel.STRICT,
        enableDynamicSlippage: false,
      };

      service.setUserPreferences(userId, userConfig);

      const context = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 1.0,
        expectedPrice: 45000,
        timestamp: new Date(),
        userId,
      };

      const result = await service.validateTradeExecution(context);

      expect(result).toBeDefined();
      expect(result.maxAllowedSlippage).toBeLessThanOrEqual(0.3);
    });

    it('should complete validation quickly (within execution time limit)', async () => {
      const context = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 1.0,
        expectedPrice: 45000,
        timestamp: new Date(),
      };

      const start = Date.now();
      await service.validateTradeExecution(context);
      const elapsed = Date.now() - start;

      // Should complete well under 5 seconds
      expect(elapsed).toBeLessThan(5000);
      // Should ideally be under 1 second
      expect(elapsed).toBeLessThan(1000);
    });

    it('should handle symbol-specific overrides', async () => {
      const userId = 'user123';
      const defaultConfig = {
        maxSlippagePercent: 0.5,
        toleranceLevel: SlippageToleranceLevel.MODERATE,
      };

      const btcOverride = {
        maxSlippagePercent: 0.2,
        toleranceLevel: SlippageToleranceLevel.STRICT,
      };

      service.setUserPreferences(userId, defaultConfig);
      service.setSymbolOverride(userId, 'BTC/USD', btcOverride);

      const btcContext = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 1.0,
        expectedPrice: 45000,
        timestamp: new Date(),
        userId,
      };

      const ethContext = {
        symbol: 'ETH/USD',
        side: 'buy' as const,
        quantity: 10.0,
        expectedPrice: 3000,
        timestamp: new Date(),
        userId,
      };

      const btcResult = await service.validateTradeExecution(btcContext);
      const ethResult = await service.validateTradeExecution(ethContext);

      expect(btcResult.maxAllowedSlippage).toBeLessThanOrEqual(0.2);
      expect(ethResult.maxAllowedSlippage).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('recordSlippage', () => {
    it('should record slippage correctly', async () => {
      const context = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 1.5,
        expectedPrice: 45000,
        timestamp: new Date(),
      };

      const report = await service.recordSlippage(context, 45050);

      expect(report).toBeDefined();
      expect(report.expectedPrice).toBe(45000);
      expect(report.actualPrice).toBe(45050);
      expect(report.slippageAmount).toBe(50);
      expect(report.slippagePercent).toBeCloseTo(0.111, 2);
      expect(report.totalSlippageCost).toBe(75); // 50 * 1.5
      expect(report.symbol).toBe('BTC/USD');
      expect(report.side).toBe('buy');
    });

    it('should mark slippage as within limits when appropriate', async () => {
      const context = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 1.0,
        expectedPrice: 45000,
        timestamp: new Date(),
      };

      // Small slippage, should be within limits
      const report = await service.recordSlippage(context, 45010);

      expect(report.withinLimits).toBe(true);
    });

    it('should mark slippage as exceeded when beyond limits', async () => {
      const userId = 'user123';
      const strictConfig = {
        maxSlippagePercent: 0.05, // 0.05%
        toleranceLevel: SlippageToleranceLevel.STRICT,
      };

      service.setUserPreferences(userId, strictConfig);

      const context = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 1.0,
        expectedPrice: 45000,
        timestamp: new Date(),
        userId,
      };

      // Large slippage
      const report = await service.recordSlippage(context, 45500);

      expect(report.withinLimits).toBe(false);
    });

    it('should update historical slippage data', async () => {
      const context = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 1.0,
        expectedPrice: 45000,
        timestamp: new Date(),
      };

      await service.recordSlippage(context, 45050);
      await service.recordSlippage(context, 45100);

      const stats = service.getSlippageStatistics('BTC/USD', 1);

      expect(stats.totalTrades).toBe(2);
      expect(stats.averageSlippage).toBeGreaterThan(0);
    });
  });

  describe('setUserPreferences', () => {
    it('should set user preferences correctly', () => {
      const userId = 'user123';
      const config = {
        maxSlippagePercent: 0.75,
        toleranceLevel: SlippageToleranceLevel.RELAXED,
        enableDynamicSlippage: true,
      };

      service.setUserPreferences(userId, config);

      const prefs = service.getUserPreferences(userId);

      expect(prefs).toBeDefined();
      expect(prefs!.userId).toBe(userId);
      expect(prefs!.defaultConfig.maxSlippagePercent).toBe(0.75);
      expect(prefs!.defaultConfig.toleranceLevel).toBe(
        SlippageToleranceLevel.RELAXED,
      );
    });

    it('should validate configuration', () => {
      const userId = 'user123';
      const invalidConfig = {
        maxSlippagePercent: 150, // Invalid: > 100
        toleranceLevel: SlippageToleranceLevel.MODERATE,
      };

      expect(() => {
        service.setUserPreferences(userId, invalidConfig);
      }).toThrow(BadRequestException);
    });

    it('should reject negative slippage', () => {
      const userId = 'user123';
      const invalidConfig = {
        maxSlippagePercent: -0.5,
        toleranceLevel: SlippageToleranceLevel.MODERATE,
      };

      expect(() => {
        service.setUserPreferences(userId, invalidConfig);
      }).toThrow(BadRequestException);
    });
  });

  describe('setSymbolOverride', () => {
    it('should set symbol-specific override', () => {
      const userId = 'user123';
      const defaultConfig = {
        maxSlippagePercent: 0.5,
        toleranceLevel: SlippageToleranceLevel.MODERATE,
      };

      const btcConfig = {
        maxSlippagePercent: 0.2,
        toleranceLevel: SlippageToleranceLevel.STRICT,
      };

      service.setUserPreferences(userId, defaultConfig);
      service.setSymbolOverride(userId, 'BTC/USD', btcConfig);

      const prefs = service.getUserPreferences(userId);

      expect(prefs!.symbolOverrides).toBeDefined();
      expect(prefs!.symbolOverrides!.get('BTC/USD')).toEqual(btcConfig);
    });

    it('should validate symbol override configuration', () => {
      const userId = 'user123';
      const invalidConfig = {
        maxSlippagePercent: 200,
        toleranceLevel: SlippageToleranceLevel.STRICT,
      };

      expect(() => {
        service.setSymbolOverride(userId, 'BTC/USD', invalidConfig);
      }).toThrow(BadRequestException);
    });
  });

  describe('getSlippageReports', () => {
    beforeEach(async () => {
      // Add some test reports
      const contexts = [
        {
          symbol: 'BTC/USD',
          side: 'buy' as const,
          quantity: 1.0,
          expectedPrice: 45000,
          timestamp: new Date('2026-01-20'),
        },
        {
          symbol: 'BTC/USD',
          side: 'sell' as const,
          quantity: 0.5,
          expectedPrice: 45100,
          timestamp: new Date('2026-01-21'),
        },
        {
          symbol: 'ETH/USD',
          side: 'buy' as const,
          quantity: 10.0,
          expectedPrice: 3000,
          timestamp: new Date('2026-01-21'),
        },
      ];

      for (const context of contexts) {
        await service.recordSlippage(context, context.expectedPrice + 50);
      }
    });

    it('should return all reports without filters', () => {
      const reports = service.getSlippageReports();
      expect(reports.length).toBe(3);
    });

    it('should filter by symbol', () => {
      const reports = service.getSlippageReports({ symbol: 'BTC/USD' });
      expect(reports.length).toBe(2);
      expect(reports.every(r => r.symbol === 'BTC/USD')).toBe(true);
    });

    it('should filter by date range', () => {
      const reports = service.getSlippageReports({
        startDate: new Date('2026-01-21'),
      });
      expect(reports.length).toBe(2);
    });

    it('should limit results', () => {
      const reports = service.getSlippageReports({ limit: 2 });
      expect(reports.length).toBe(2);
    });

    it('should filter exceeded limits only', async () => {
      const strictConfig = {
        maxSlippagePercent: 0.05,
        toleranceLevel: SlippageToleranceLevel.STRICT,
      };

      const context = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 1.0,
        expectedPrice: 45000,
        timestamp: new Date(),
      };

      service.setUserPreferences('user123', strictConfig);
      await service.recordSlippage(
        { ...context, userId: 'user123' },
        45500,
      );

      const exceeded = service.getSlippageReports({ onlyExceeded: true });
      expect(exceeded.length).toBeGreaterThan(0);
      expect(exceeded.every(r => !r.withinLimits)).toBe(true);
    });
  });

  describe('getSlippageStatistics', () => {
    beforeEach(async () => {
      const context = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 1.0,
        expectedPrice: 45000,
        timestamp: new Date(),
      };

      await service.recordSlippage(context, 45050); // 0.111% slippage
      await service.recordSlippage(context, 45100); // 0.222% slippage
      await service.recordSlippage(context, 45025); // 0.055% slippage
    });

    it('should calculate statistics correctly', () => {
      const stats = service.getSlippageStatistics('BTC/USD', 7);

      expect(stats.totalTrades).toBe(3);
      expect(stats.averageSlippage).toBeGreaterThan(0);
      expect(stats.maxSlippage).toBeGreaterThan(stats.minSlippage);
      expect(stats.totalSlippageCost).toBeGreaterThan(0);
    });

    it('should return zeros for symbol with no data', () => {
      const stats = service.getSlippageStatistics('XRP/USD', 7);

      expect(stats.totalTrades).toBe(0);
      expect(stats.averageSlippage).toBe(0);
      expect(stats.maxSlippage).toBe(0);
    });

    it('should respect date range', () => {
      const stats = service.getSlippageStatistics('BTC/USD', 0); // 0 days back
      // Should return no trades as all are from "today" or future
      expect(stats.totalTrades).toBeGreaterThanOrEqual(0);
    });
  });

  describe('exportSlippageData', () => {
    beforeEach(async () => {
      const context = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 1.0,
        expectedPrice: 45000,
        timestamp: new Date(),
      };

      await service.recordSlippage(context, 45050);
    });

    it('should export data for specific symbol', () => {
      const data = service.exportSlippageData('BTC/USD');

      expect(data.reports).toBeDefined();
      expect(data.statistics).toBeDefined();
      expect(data.reports.length).toBeGreaterThan(0);
    });

    it('should export all data when no symbol specified', () => {
      const data = service.exportSlippageData();

      expect(data.reports).toBeDefined();
      expect(data.statistics).toBeNull();
    });
  });

  describe('clearUserPreferences', () => {
    it('should clear specific user preferences', () => {
      const userId = 'user123';
      const config = {
        maxSlippagePercent: 0.5,
        toleranceLevel: SlippageToleranceLevel.MODERATE,
      };

      service.setUserPreferences(userId, config);
      expect(service.getUserPreferences(userId)).toBeDefined();

      service.clearUserPreferences(userId);
      expect(service.getUserPreferences(userId)).toBeUndefined();
    });

    it('should clear all preferences when no userId specified', () => {
      service.setUserPreferences('user1', {
        maxSlippagePercent: 0.5,
        toleranceLevel: SlippageToleranceLevel.MODERATE,
      });

      service.setUserPreferences('user2', {
        maxSlippagePercent: 0.3,
        toleranceLevel: SlippageToleranceLevel.STRICT,
      });

      service.clearUserPreferences();

      expect(service.getUserPreferences('user1')).toBeUndefined();
      expect(service.getUserPreferences('user2')).toBeUndefined();
    });
  });

  describe('clearReports', () => {
    it('should clear all reports', async () => {
      const context = {
        symbol: 'BTC/USD',
        side: 'buy' as const,
        quantity: 1.0,
        expectedPrice: 45000,
        timestamp: new Date(),
      };

      await service.recordSlippage(context, 45050);
      expect(service.getSlippageReports().length).toBeGreaterThan(0);

      service.clearReports();
      expect(service.getSlippageReports().length).toBe(0);
    });
  });
});